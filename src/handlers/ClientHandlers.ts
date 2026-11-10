import { McpError, ErrorCode } from "../lib/errors.js";
import { BaseHandler } from "./BaseHandler.js";
import type { ToolDefinition } from "../types/tools.js";
import type { RegistroClientes } from "../clients.js";

export class ClientHandlers extends BaseHandler {
  private registro: RegistroClientes;

  constructor(adtclient: any, registro: RegistroClientes) {
    super(adtclient);
    this.registro = registro;
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: 'listarClientes',
        description: 'List the configured SAP customers/systems and which one is active. Passwords are never returned.',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'usarCliente',
        description: 'Switch the active SAP customer/system. All later calls go to that system.',
        inputSchema: {
          type: 'object',
          properties: { cliente: { type: 'string', description: 'Name as defined in clientes.json' } },
          required: ['cliente']
        }
      },
      {
        name: 'clienteActual',
        description: 'Return the currently active SAP customer/system.',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'recargarClientes',
        description: 'Reload clientes.json from disk without restarting the server.',
        inputSchema: { type: 'object', properties: {} }
      }
    ];
  }

  async handle(toolName: string, args: any): Promise<any> {
    const wrap = (o: any) => ({ content: [{ type: 'text', text: JSON.stringify({ status: 'success', ...o }) }] });
    try {
      switch (toolName) {
        case 'listarClientes':   return wrap(this.registro.listar());
        case 'usarCliente':      return wrap(this.registro.usar(args.cliente));
        case 'clienteActual':    return wrap({ activo: this.registro.nombreActivo });
        case 'recargarClientes': return wrap(this.registro.recargar());
        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown client tool: ${toolName}`);
      }
    } catch (e: any) {
      if (e instanceof McpError) throw e;
      throw new McpError(ErrorCode.InvalidParams, 'Unknown client or client configuration invalid');
    }
  }
}
