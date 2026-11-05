import { ADTClient, session_types } from 'abap-adt-api';
import fs from 'fs';
import path from 'path';
import { AsyncLocalStorage } from 'async_hooks';
import { loginSucceeded, observeFailure, recoveryError, recoveryRequired, recoveryVersion, requestTimeout } from './lib/sessionRecovery';

const proxies = new WeakMap<ADTClient, RegistroClientes>();

/** Resolve the actual ADT connection behind a registry proxy, including its request pin. */
export function connectionFor(client: ADTClient): ADTClient {
  return proxies.get(client)?.connectionActual ?? client;
}

export interface ClienteDef {
  descripcion?: string;
  url: string;
  mandante?: string;   // sap-client (100, 400...)
  usuario: string;
  password: string;
  idioma?: string;
}

interface Registro {
  porDefecto?: string;
  clientes: Record<string, ClienteDef>;
}

const ARCHIVO = path.resolve(__dirname, '../clientes.json');

/**
 * Registro de sistemas SAP. Un solo archivo con todos los clientes.
 * El servidor mantiene una conexion por cliente y se cambia con `usarCliente`.
 */
export class RegistroClientes {
  private def: Registro = { clientes: {} };
  private conexiones = new Map<string, ADTClient>();
  private activo = '';
  private readonly requestConnection = new AsyncLocalStorage<ADTClient>();
  private readonly timeout: number;

  /** Snapshot the selected client at the start of a tool request; no global lock. */
  withPinnedConnection<T>(operation: () => Promise<T>): Promise<T> {
    return this.requestConnection.run(this.conexion(), operation);
  }

  get connectionActual(): ADTClient {
    return this.requestConnection.getStore() ?? this.conexion();
  }

  constructor() {
    this.timeout = requestTimeout(process.env.SAP_REQUEST_TIMEOUT_MS);
    this.cargar();
  }

  private cargar() {
    if (fs.existsSync(ARCHIVO)) {
      this.def = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
    }
    // Compatibilidad: si no hay archivo pero si variables de entorno,
    // se arma un cliente unico llamado "default".
    if (Object.keys(this.def.clientes || {}).length === 0 && process.env.SAP_URL) {
      this.def = {
        porDefecto: 'default',
        clientes: {
          default: {
            descripcion: 'Desde variables de entorno',
            url: process.env.SAP_URL as string,
            mandante: process.env.SAP_CLIENT,
            usuario: process.env.SAP_USER as string,
            password: process.env.SAP_PASSWORD as string,
            idioma: process.env.SAP_LANGUAGE
          }
        }
      };
    }
    const nombres = Object.keys(this.def.clientes || {});
    if (nombres.length === 0) {
      throw new Error(
        `No hay clientes configurados. Crea ${ARCHIVO} o define SAP_URL, SAP_USER y SAP_PASSWORD.`
      );
    }
    const inicial = process.env.SAP_CLIENTE || this.def.porDefecto || nombres[0];
    if (!this.def.clientes[inicial]) {
      throw new Error(`El cliente "${inicial}" no existe. Disponibles: ${nombres.join(', ')}`);
    }
    this.activo = inicial;
  }

  recargar() {
    const previo = this.activo;
    this.def = { clientes: {} };
    this.conexiones.clear();
    this.cargar();
    if (this.def.clientes[previo]) this.activo = previo;
    return this.listar();
  }

  listar() {
    return {
      activo: this.activo,
      clientes: Object.entries(this.def.clientes).map(([nombre, c]) => ({
        nombre,
        descripcion: c.descripcion || '',
        url: c.url,
        mandante: c.mandante || '',
        usuario: c.usuario,
        activo: nombre === this.activo
      }))
    };
  }

  usar(nombre: string) {
    if (!this.def.clientes[nombre]) {
      throw new Error(
        `El cliente "${nombre}" no existe. Disponibles: ${Object.keys(this.def.clientes).join(', ')}`
      );
    }
    this.activo = nombre;
    const c = this.def.clientes[nombre];
    return { activo: nombre, descripcion: c.descripcion || '', url: c.url, mandante: c.mandante, usuario: c.usuario };
  }

  get nombreActivo() { return this.activo; }

  private conexion(): ADTClient {
    let cli = this.conexiones.get(this.activo);
    if (!cli) {
      const c = this.def.clientes[this.activo];
      cli = new ADTClient(c.url, c.usuario, c.password, c.mandante as string, c.idioma as string, { timeout: this.timeout });
      (cli as any).stateful = session_types.stateful;
      this.conexiones.set(this.activo, cli);
    }
    return cli;
  }

  private observedCall(real: ADTClient, method: (...args: any[]) => any, name: string | symbol) {
    return (...args: any[]) => {
      if (name !== 'login' && name !== 'logout' && name !== 'dropSession' && recoveryRequired(real)) {
        throw recoveryError();
      }
      const version = recoveryVersion(real);
      try {
        const result = method(...args);
        if (result && typeof result.then === 'function') {
          return Promise.resolve(result).then(value => {
            if (name === 'login') loginSucceeded(real, version);
            return value;
          }, error => {
            observeFailure(real, error, version);
            throw error;
          });
        }
        if (name === 'login') loginSucceeded(real, version);
        return result;
      } catch (error) {
        observeFailure(real, error, version);
        throw error;
      }
    };
  }

  /**
   * Proxy que delega siempre en la conexion del cliente activo.
   * Permite cambiar de sistema sin reconstruir los handlers.
   */
  get cliente(): ADTClient {
    const self = this;
    const proxy = new Proxy({} as ADTClient, {
      get(_t, prop) {
        const real: any = self.connectionActual;
        if (prop === 'httpClient') {
          const http = real.httpClient;
          return new Proxy(http, {
            get(target, key) {
              const value = (target as any)[key];
              return key === 'request' ? self.observedCall(real, value.bind(target), 'request')
                : typeof value === 'function' ? value.bind(target) : value;
            }
          });
        }
        const val = real[prop];
        return typeof val === 'function' ? self.observedCall(real, val.bind(real), prop) : val;
      },
      set(_t, prop, val) {
        (self.connectionActual as any)[prop as any] = val;
        return true;
      }
    });
    proxies.set(proxy, this);
    return proxy;
  }
}
