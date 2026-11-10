import { stringify } from "../lib/results.js";
import { McpError, ErrorCode } from "../lib/errors.js";
import { BaseHandler } from "./BaseHandler.js";
import type { ToolDefinition } from "../types/tools.js";

export class AuthHandlers extends BaseHandler {
  getTools(): ToolDefinition[] {
    return [
      {
        name: "login",
        description: "Explicitly authenticate after inspecting uncertain writes; reacquire locks deliberately. No write is replayed.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "logout",
        description: "Terminate the selected ABAP session; reacquire locks before later writes.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "dropSession",
        description: "Clear local session cache; after uncertain writes explicitly login and reacquire locks. No write is replayed.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ];
  }

  async handle(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case "login":
        return this.handleLogin(args);
      case "logout":
        return this.handleLogout(args);
      case "dropSession":
        return this.handleDropSession(args);
      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown auth tool: ${toolName}`,
        );
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
            type: "text",
            text: stringify({ status: "Logged in successfully" }),
          },
        ],
      };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      throw error;
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
            type: "text",
            text: stringify({ status: "Logged out successfully" }),
          },
        ],
      };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      throw error;
    }
  }

  private async handleDropSession(args: any) {
    const startTime = performance.now();
    try {
      this.sourceCache.clear();
      await this.adtclient.dropSession();
      this.trackRequest(startTime, true);
      return {
        content: [
          {
            type: "text",
            text: stringify({ status: "Session cleared" }),
          },
        ],
      };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      throw error;
    }
  }
}
