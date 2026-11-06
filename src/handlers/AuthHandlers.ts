import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';
import { connectionError } from '../lib/connectionDiagnostics';

export class AuthHandlers extends BaseHandler {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'login',
        description: 'Explicitly authenticate the selected ABAP session to clear recovery-required state after inspecting uncertain write outcomes. Returns a fixed success status, not SDK login data. Reacquire locks deliberately; login does not restore lost locks. Failures retain recovery-required state.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'logout',
        description: 'Explicitly log out the selected ABAP session. A confirmed already-expired session is treated as logged out locally (not HTTP success); its connection and locks must be reacquired. Other failures return safe connection diagnostics.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'dropSession',
        description: 'Explicitly drop the selected ABAP session after inspecting uncertain write outcomes. Drop alone does not clear recovery-required state or cached cookies/CSRF: login explicitly and reacquire locks; no write is replayed.',
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
      await this.adtclient.login();
      this.trackRequest(startTime, true);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ status: 'Logged in successfully' })
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
