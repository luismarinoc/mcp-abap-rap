import { ADTClient, session_types } from "abap-adt-api";
import fs from "fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { CompatibleAdtClient } from "./lib/adt-client.js";
import { BoundedHttpClient, validatedSapOrigin } from "./lib/http.js";
import { SourceCache, cacheFor, clearConnectionCache } from "./lib/sourceCache.js";
import { connectionRetired, loginSucceeded, observeFailure, recoveryError, recoveryRequired, recoveryVersion, retireConnection } from "./lib/sessionRecovery.js";
import { isExpiredLogoutSession } from "./lib/logoutSession.js";

const proxies = new WeakMap<ADTClient, RegistroClientes>();
export function connectionFor(client: ADTClient): ADTClient {
  return proxies.get(client)?.connectionActual ?? client;
}
export function cacheForConnection(client: ADTClient, fallback: SourceCache): SourceCache {
  return proxies.get(client)?.cache() ?? fallback;
}
export interface ClienteDef {
  descripcion?: string;
  url: string;
  mandante?: string;
  usuario: string;
  password: string;
  idioma?: string;
}
interface Registro {
  porDefecto?: string;
  clientes: Record<string, ClienteDef>;
}

/** A tool request pins its physical connection, even when selection changes concurrently. */
export class RegistroClientes {
  private def: Registro = { clientes: {} };
  private conexiones = new Map<string, ADTClient>();
  private activo = "";
  private readonly requestConnection = new AsyncLocalStorage<ADTClient>();
  private readonly file: string;
  constructor(private readonly env: NodeJS.ProcessEnv = process.env, file?: string) {
    this.file = file ?? path.resolve(process.cwd(), "clientes.json");
    this.cargar();
  }
  get configured() { return this.activo !== ""; }
  withPinnedConnection<T>(operation: () => Promise<T>): Promise<T> {
    return this.requestConnection.run(this.connectionActual, operation);
  }
  get connectionActual(): ADTClient {
    return this.requestConnection.getStore() ?? this.conexion();
  }
  private cargar() {
    if (fs.existsSync(this.file)) this.def = JSON.parse(fs.readFileSync(this.file, "utf8"));
    if (Object.keys(this.def.clientes || {}).length === 0 && this.env.SAP_URL && this.env.SAP_USER &&
        (this.env.SAP_PASSWORD || this.env.SAP_BEARER_TOKEN)) {
      this.def = { porDefecto: "default", clientes: { default: {
        descripcion: "Desde variables de entorno", url: this.env.SAP_URL,
        mandante: this.env.SAP_CLIENT, usuario: this.env.SAP_USER,
        password: this.env.SAP_PASSWORD ?? "", idioma: this.env.SAP_LANGUAGE,
      } } };
    }
    const names = Object.keys(this.def.clientes || {});
    if (!names.length) { this.activo = ""; return; }
    const initial = this.env.SAP_CLIENTE || this.def.porDefecto || names[0];
    if (!this.def.clientes[initial])
      throw new Error(`El cliente "${initial}" no existe. Disponibles: ${names.join(", ")}`);
    for (const c of Object.values(this.def.clientes)) {
      validatedSapOrigin(c.url, this.env.SAP_ALLOW_HTTP);
      if (c.mandante && !/^\d{3}$/.test(c.mandante)) throw new Error("SAP_CLIENT must have three digits");
      if (!c.usuario || !(c.password || (names.length === 1 && this.env.SAP_BEARER_TOKEN)))
        throw new Error("SAP user and password or bearer token are required");
    }
    this.activo = initial;
  }
  recargar() {
    const previo = this.activo;
    this.def = { clientes: {} };
    // In-flight requests retain their pinned physical client; a reload creates fresh identities.
    for (const cli of this.conexiones.values()) clearConnectionCache(cli);
    this.conexiones.clear();
    this.cargar();
    if (this.def.clientes[previo]) this.activo = previo;
    return this.listar();
  }
  listar() {
    return { activo: this.activo, clientes: Object.entries(this.def.clientes).map(([nombre, c]) => ({
      nombre, descripcion: c.descripcion || "", url: c.url, mandante: c.mandante || "",
      usuario: c.usuario, activo: nombre === this.activo,
    })) };
  }
  usar(nombre: string) {
    if (!this.def.clientes[nombre]) throw new Error(`El cliente "${nombre}" no existe. Disponibles: ${Object.keys(this.def.clientes).join(", ")}`);
    this.activo = nombre;
    const c = this.def.clientes[nombre];
    return { activo: nombre, descripcion: c.descripcion || "", url: c.url, mandante: c.mandante, usuario: c.usuario };
  }
  get nombreActivo() { return this.activo; }
  get selectedRecoveryRequired() {
    const client = this.conexiones.get(this.activo);
    return client ? recoveryRequired(client) : false;
  }
  private conexion(): ADTClient {
    if (!this.configured) throw new Error("No hay clientes configurados. Define SAP_URL, SAP_USER y SAP_PASSWORD o configura clientes.json.");
    let cli = this.conexiones.get(this.activo);
    if (!cli) {
      const c = this.def.clientes[this.activo];
      const bearer = this.env.SAP_BEARER_TOKEN;
      cli = new CompatibleAdtClient(new BoundedHttpClient(validatedSapOrigin(c.url, this.env.SAP_ALLOW_HTTP)),
        c.usuario, bearer && Object.keys(this.def.clientes).length === 1 ? async () => bearer : c.password,
        c.mandante ?? "", c.idioma ?? "", { keepAlive: false });
      cli.stateful = session_types.stateful;
      this.conexiones.set(this.activo, cli);
    }
    return cli;
  }
  private retire(real: ADTClient): void {
    retireConnection(real);
    clearConnectionCache(real);
    for (const [name, client] of this.conexiones)
      if (client === real) this.conexiones.delete(name);
  }
  private observedCall(real: ADTClient, method: (...args: any[]) => any, name: string | symbol) {
    return (...args: any[]) => {
      if (connectionRetired(real) || (name !== "login" && name !== "logout" && name !== "dropSession" && recoveryRequired(real)))
        throw recoveryError();
      const version = recoveryVersion(real);
      try {
        const result = method(...args);
        if (result && typeof result.then === "function")
          return Promise.resolve(result).then(value => {
            if (name === "login") loginSucceeded(real, version);
            if (name === "logout") this.retire(real);
            return value;
          }, error => {
            if (name === "logout" && isExpiredLogoutSession(error)) { this.retire(real); return undefined; }
            observeFailure(real, error, version);
            throw error;
          });
        if (name === "login") loginSucceeded(real, version);
        if (name === "logout") this.retire(real);
        return result;
      } catch (error) { observeFailure(real, error, version); throw error; }
    };
  }
  get cliente(): ADTClient {
    const self = this;
    const proxy = new Proxy({} as ADTClient, {
      get(_t, prop) {
        const real: any = self.connectionActual;
        if (prop === "httpClient") {
          const http = real.httpClient;
          return new Proxy(http, { get(target, key) {
            const value = (target as any)[key];
            return key === "request" ? self.observedCall(real, value.bind(target), "request")
              : typeof value === "function" ? value.bind(target) : value;
          } });
        }
        if (prop === "loggedin" && connectionRetired(real)) return false;
        const val = real[prop];
        return typeof val === "function" ? self.observedCall(real, val.bind(real), prop) : val;
      },
      set(_t, prop, val) { (self.connectionActual as any)[prop as any] = val; return true; },
    });
    proxies.set(proxy, this);
    return proxy;
  }
  cache() { return cacheFor(this.connectionActual); }
  clearCache() { clearConnectionCache(this.connectionActual); }
  existingConnections(): ADTClient[] { return [...this.conexiones.values()]; }
  close() {
    for (const cli of this.conexiones.values()) clearConnectionCache(cli);
    this.conexiones.clear();
  }
}
