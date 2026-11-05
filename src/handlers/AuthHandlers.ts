import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';
import { connectionError } from '../lib/connectionDiagnostics';

export class AuthHandlers extends BaseHandler {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'login',
        description: 'Explicitly authenticate with the selected ABAP system after inspecting any uncertain write outcome. Does not restore lost locks. Failures return safe connection diagnostics.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'logout',
        description: 'Explicitly terminate the selected ABAP session; existing locks may no longer be usable. Failures return safe connection diagnostics.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'dropSession',
        description: 'Explicitly clear the selected ABAP session cache after inspecting SAP for uncertain write outcomes. Re-login and reacquire locks deliberately; no write is replayed. Failures return safe connection diagnostics.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    ];
  }

  async handle(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case 'login':
        return this.handleLogin(args);
      case 'logout':
        return this.handleLogout(args);
      case 'dropSession':
        return this.handleDropSession(args);
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown auth tool: ${toolName}`);
    }
  }

  private async handleLogin(args: any) {
    const startTime = performance.now();
    try {
      const loginResult = await this.adtclient.login();
      this.trackRequest(startTime, true);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(loginResult)
          }
        ]
      };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      throw connectionError(error, 'Login failed');
    }
  }

  private async handleLogout(args: any) {
    const startTime = performance.now();
    try {
      await this.adtclient.logout();
      this.trackRequest(startTime, true);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ status: 'Logged out successfully' })
          }
        ]
      };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      throw connectionError(error, 'Logout failed');
    }
  }

  private async handleDropSession(args: any) {
    const startTime = performance.now();
    try {
      await this.adtclient.dropSession();
      this.trackRequest(startTime, true);
      return {
        content: [
          {
            type: 'text', 
            text: JSON.stringify({ status: 'Session cleared' })
          }
        ]
      };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      throw connectionError(error, 'Drop session failed');
    }
  }
}
