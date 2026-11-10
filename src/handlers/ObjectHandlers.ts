import { stringify } from "../lib/results.js";
import { McpError, ErrorCode } from "../lib/errors.js";
import { BaseHandler } from "./BaseHandler.js";
import type { ToolDefinition } from "../types/tools.js";
import { ADTClient } from "abap-adt-api";

export class ObjectHandlers extends BaseHandler {
  getTools(): ToolDefinition[] {
    return [
      {
        name: "objectStructure",
        description: "Get object structure details",
        inputSchema: {
          type: "object",
          properties: {
            objectUrl: {
              type: "string",
              description: "URL of the object",
            },
            version: {
              type: "string",
              description: "Version of the object",
              optional: true,
            },
          },
          required: ["objectUrl"],
        },
      },
      {
        name: "searchObject",
        description: "Search for objects",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query string",
            },
            objType: {
              type: "string",
              description: "Object type filter",
              optional: true,
            },
            max: {
              type: "number",
              description: "Legacy maximum; cannot be combined with offset or pageSize",
              optional: true,
            },
            offset: { type: "number", description: "Optional zero-based offset; local SDK prefix slice, at most 10000 rows", optional: true },
            pageSize: { type: "number", description: "Positive page size; offset + pageSize at most 10000", optional: true },
          },
          required: ["query"],
        },
      },
      {
        name: "findObjectPath",
        description: "Find path for an object",
        inputSchema: {
          type: "object",
          properties: {
            objectUrl: {
              type: "string",
              description: "URL of the object to find path for",
            },
          },
          required: ["objectUrl"],
        },
      },
      {
        name: "objectTypes",
        description: "Retrieves object types, optionally filtered case-insensitively by type, name or description.",
        inputSchema: {
          type: "object",
          properties: { filter: { type: "string", optional: true } },
        },
      },
      {
        name: "reentranceTicket",
        description: "Retrieves a reentrance ticket.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ];
  }

  async handle(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case "objectStructure":
        return this.handleObjectStructure(args);
      case "findObjectPath":
        return this.handleFindObjectPath(args);
      case "searchObject":
        return this.handleSearchObject(args);
      case "objectTypes":
        return this.handleObjectTypes(args);
      case "reentranceTicket":
        return this.handleReentranceTicket(args);
      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown object tool: ${toolName}`,
        );
    }
  }

  async handleObjectStructure(args: any): Promise<any> {
    const startTime = performance.now();
    try {
      const structure = await this.adtclient.objectStructure(
        args.objectUrl,
        args.version,
      );
      this.trackRequest(startTime, true);
      return {
        content: [
          {
            type: "text",
            text: stringify(
              {
                status: "success",
                structure,
                message: "Object structure retrieved successfully",
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      throw error;
    }
  }

  async handleFindObjectPath(args: any): Promise<any> {
    const startTime = performance.now();
    try {
      const path = await this.adtclient.findObjectPath(args.objectUrl);
      this.trackRequest(startTime, true);
      return {
        content: [
          {
            type: "text",
            text: stringify(
              {
                status: "success",
                path,
                message: "Object path found successfully",
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      throw error;
    }
  }

  async handleSearchObject(args: any): Promise<any> {
    const paging = args.offset !== undefined || args.pageSize !== undefined;
    const offset = args.offset ?? 0;
    const pageSize = args.pageSize ?? 100;
    if (paging) {
      if (args.max !== undefined) throw new McpError(ErrorCode.InvalidParams, "max cannot be combined with offset or pageSize");
      if (!Number.isSafeInteger(offset) || offset < 0) throw new McpError(ErrorCode.InvalidParams, "offset must be a finite nonnegative integer");
      if (!Number.isSafeInteger(pageSize) || pageSize <= 0) throw new McpError(ErrorCode.InvalidParams, "pageSize must be a finite positive integer");
      if (offset + pageSize > 10000) throw new McpError(ErrorCode.InvalidParams, "offset + pageSize must be at most 10000");
    }
    const startTime = performance.now();
    try {
      const fetched = await this.adtclient.searchObject(args.query, args.objType, paging ? offset + pageSize : args.max);
      const results = paging ? fetched.slice(offset, offset + pageSize) : fetched;
      this.trackRequest(startTime, true);
      return { content: [{ type: "text", text: stringify({ status: "success", results,
        message: "Object search completed successfully",
        ...(paging ? { paging: { offset, pageSize, returned: results.length } } : {}) }, null, 2) }] };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      throw error;

    }
  }

  async handleObjectTypes(args: any): Promise<any> {
    const startTime = performance.now();
    try {
      const allTypes = await this.adtclient.objectTypes();
      const filter = args.filter?.toLowerCase();
      const types = filter === undefined ? allTypes : allTypes.filter(type =>
        [type.type, type.name, type.description].some(value => value?.toLowerCase().includes(filter)));
      this.trackRequest(startTime, true);
      return { content: [{ type: "text", text: stringify({ status: "success", types,
        message: "Object types retrieved successfully" }, null, 2) }] };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      throw error;

    }
  }

  async handleReentranceTicket(args: any): Promise<any> {
    const startTime = performance.now();
    try {
      const ticket = await this.adtclient.reentranceTicket();
      this.trackRequest(startTime, true);
      return {
        content: [
          {
            type: "text",
            text: stringify(
              {
                status: "success",
                ticket,
                message: "Reentrance ticket retrieved successfully",
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      throw error;
    }
  }
}
