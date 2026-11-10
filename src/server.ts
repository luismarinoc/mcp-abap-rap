import { McpServer } from "@modelcontextprotocol/server";
import { ADTClient, session_types } from "abap-adt-api";
import { RegistroClientes, connectionFor } from "./clients.js";
import { recoveryRequired, interruptConnection } from "./lib/sessionRecovery.js";
import { z } from "zod";
import { createHandlers } from "./handlers/registry.js";
import { SourceCache, clearConnectionCache } from "./lib/sourceCache.js";
import { ResultPages, textResult } from "./lib/results.js";
import { requestContext } from "./lib/http.js";
import { ErrorCode, McpError, safeError } from "./lib/errors.js";
import { toolSchema } from "./schema.js";
import { connectionDiagnostic } from "./lib/connectionDiagnostics.js";
const mutations = new Set(
  `login logout dropSession adtRequest createObjectSafe setSourceByName createAndActivate createFullRapService recargarClientes createTransport setTransportsConfig createTransportsConfig transportDelete transportRelease transportSetOwner transportAddUser lock unLock setObjectSource deleteObject activateObjects activateByName createObject runClass createTestInclude setPrettyPrinterSetting gitCreateRepo gitPullRepo gitUnlinkRepo stageRepo pushRepo switchRepoBranch publishServiceBinding unPublishServiceBinding debuggerListen debuggerDeleteListener debuggerSetBreakpoints debuggerDeleteBreakpoints debuggerAttach debuggerSaveSettings debuggerStep debuggerGoToStack debuggerSetVariableValue renameExecute createAtcRun atcRequestExemption atcChangeContact tracesSetParameters tracesCreateConfiguration tracesDeleteConfiguration tracesDelete extractMethodExecute unitTestRun unitTestEvaluation`.split(
    " ",
  ),
);
function argumentSecrets(args: unknown): string[] {
  const found: string[] = [];
  const visit = (value: unknown) => {
    if (value && typeof value === "object")
      for (const [key, child] of Object.entries(value)) {
        if (
          /password|token|authorization/i.test(key) &&
          typeof child === "string" &&
          child
        ) {
          found.push(
            child,
            Buffer.from(child).toString("base64"),
            encodeURIComponent(child),
          );
        } else visit(child);
      }
  };
  visit(args);
  return found;
}
const local = new Set(["healthcheck", "readResultPage", "isProposalMessage", "listarClientes", "usarCliente", "clienteActual", "recargarClientes", "objectPathFor"]);
const clientTools = new Set(["listarClientes", "usarCliente", "clienteActual", "recargarClientes"]);
export class Runtime {
  readonly cache = new SourceCache();
  readonly pages = new ResultPages();
  readonly handlers;
  readonly tools;
  readonly client?: ADTClient;
  readonly registry: RegistroClientes;
  readonly secrets: string[];
  readonly timeoutMs: number;
  private active?: { abort: AbortController; done: Promise<unknown> };
  private closing = false;
  private recoveryRequired = false;
  constructor(env: NodeJS.ProcessEnv = process.env, clientFile?: string) {
    this.secrets = [env.SAP_PASSWORD ?? "", env.SAP_BEARER_TOKEN ?? ""];
    this.timeoutMs = Number(env.SAP_REQUEST_TIMEOUT_MS ?? 60000);
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 120000)
      throw new Error("SAP_REQUEST_TIMEOUT_MS must be 100..120000");
    if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0")
      throw new Error("TLS verification cannot be disabled; configure NODE_EXTRA_CA_CERTS");
    this.registry = new RegistroClientes(env, clientFile);
    this.client = this.registry.configured ? this.registry.cliente : undefined;
    this.handlers = createHandlers(this.client, this.cache, this.registry);
    this.tools = this.handlers.flatMap((handler) =>
      handler
        .getTools()
        .map((definition) => ({
          definition,
          handler,
          validation: toolSchema(definition),
        })),
    );
    if (
      new Set(this.tools.map((t) => t.definition.name)).size !==
      this.tools.length
    )
      throw new Error("Duplicate tool name");
  }
  async invoke(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    if (this.closing)
      throw new McpError(ErrorCode.InternalError, "Server is closing");
    if (name === "healthcheck") {
      const result: Record<string, unknown> = {
        status: "healthy",
        timestamp: new Date().toISOString(),
        sapConfigured: !!this.client,
        sapConnectionVerified: false,
        sessionRecoveryRequired: this.recoveryRequired || this.registry.selectedRecoveryRequired,
        tools: this.tools.length + 2,
      };
      if (args.probeSap === true && this.client) {
        const abort = new AbortController();
        const expired = Symbol("probe deadline");
        let timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<never>((_, reject) => {
          timer = setTimeout(() => { abort.abort(); reject(expired); }, 5000);
        });
        try {
          await Promise.race([
            requestContext.run({ signal: abort.signal }, () =>
              this.registry.connectionActual.statelessClone.httpClient.request("/sap/bc/adt/discovery", { method: "GET", timeout: 5000 })),
            deadline,
          ]);
          result.sap = { status: "reachable", session: "independent stateless session" };
        } catch (error) {
          result.sap = { status: "unreachable", session: "independent stateless session",
            diagnostic: error === expired ? { category: "timeout" } : connectionDiagnostic(error) };
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
      return textResult(result);
    }
    if (name === "readResultPage")
      return textResult(
        this.pages.read(
          String(args.resultId),
          Number(args.offset ?? 0),
          Number(args.maxCharacters ?? 16000),
        ),
      );
    const entry = this.tools.find((t) => t.definition.name === name);
    if (!entry) throw new McpError(ErrorCode.MethodNotFound, "Unknown tool");
    const parsed = entry.validation.schema.safeParse(args);
    if (!parsed.success)
      throw new McpError(
        ErrorCode.InvalidParams,
        "Arguments do not match the tool schema",
      );
    const prepared = entry.validation.prepare(parsed.data);
    if (signal?.aborted)
      throw new McpError(
        ErrorCode.InternalError,
        "Request cancelled before SAP operation",
      );
    if (this.active && !clientTools.has(name))
      throw new McpError(
        429,
        "SAP session is busy; cancel or finish the active request first",
      );
    if (
      (this.recoveryRequired || (this.client && !clientTools.has(name) && recoveryRequired(connectionFor(this.client)))) &&
      !["login", "logout", "dropSession"].includes(name) && !clientTools.has(name)
    )
      throw new McpError(
        ErrorCode.InternalError,
        "Previous operation was interrupted. Inspect SAP before retrying a write; login explicitly and reacquire locks",
        { category: "recovery_required" },
      );
    const selected = this.client && !clientTools.has(name) ? connectionFor(this.client) : undefined;
    const abort = new AbortController();
    const cancel = () => abort.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    const deadline = performance.now() + this.timeoutMs;
    const timer = setTimeout(cancel, this.timeoutMs);
    if (mutations.has(name) && name !== "logout") {
      if (this.registry.configured) this.registry.clearCache();
      else this.cache.clear();
      this.pages.clear();
    }
    if (this.client && !["logout", "dropSession"].includes(name))
      this.client.stateful = session_types.stateful;
    const done = requestContext.run({ signal: abort.signal }, () => this.registry.configured
      ? this.registry.withPinnedConnection(async () => {
      abort.signal.throwIfAborted();
      const result = await entry.handler.handle(name, prepared);
      if (performance.now() > deadline) abort.abort();
      abort.signal.throwIfAborted();
      if (name === "login") this.recoveryRequired = false;
      if (name === "logout") this.pages.clear();
      return this.pages.wrap(result);
    }) : (async () => {
      const result = await entry.handler.handle(name, prepared);
      return this.pages.wrap(result);
    })());
    if (!clientTools.has(name)) this.active = { abort, done };
    try {
      return await done;
    } catch (error) {
      if (abort.signal.aborted) {
        if (selected) interruptConnection(selected);
        else this.recoveryRequired = true;
        if (selected) clearConnectionCache(selected);
        else this.cache.clear();
        this.pages.clear();
        throw new McpError(
          ErrorCode.InternalError,
          "SAP operation cancelled or timed out; inspect writes and locks before explicit session recovery",
        );
      }
      const diagnostic = connectionDiagnostic(error);
      throw new McpError(
        error instanceof McpError ? error.code : ErrorCode.InternalError,
        diagnostic.category === "recovery_required"
          ? "SAP session recovery required; write outcome may be unknown. Inspect SAP before retrying a write; login explicitly and reacquire locks."
          : error instanceof McpError ||
            (error && typeof error === "object" && error.constructor?.name?.startsWith("Adt"))
            ? safeError(error, [...this.secrets, ...argumentSecrets(prepared)])
            : "SAP operation failed; outcome may be unknown. Inspect SAP before retrying a write; use dropSession/login explicitly for recovery.",
        diagnostic,
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      if (!clientTools.has(name)) this.active = undefined;
    }
  }
  async close() {
    this.closing = true;
    this.active?.abort.abort();
    await this.active?.done.catch(() => {});
    this.cache.clear();
    this.pages.clear();
    for (const client of this.registry.existingConnections()) {
      if (!client.loggedin) continue;
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 2000);
      try {
        await requestContext.run({ signal: abort.signal }, () => client.logout());
      } catch {
      } finally {
        clearTimeout(timer);
      }
    }
    this.registry.close();
  }
}
export function createServer(runtime: Runtime) {
  const server = new McpServer({
    name: "mcp-abap-abap-adt-api",
    version: "0.1.1",
  });
  const active = new Map<string | number, AbortController>();
  server.server.setNotificationHandler(
    "notifications/cancelled",
    async (notification) => {
      if (notification.params?.requestId !== undefined)
        active.get(notification.params.requestId)?.abort();
    },
  );
  const register = (name: string, description: string, schema: z.ZodType) =>
    server.registerTool(
      name,
      {
        description,
        inputSchema: schema,
        annotations: {
          readOnlyHint: !mutations.has(name),
          destructiveHint: mutations.has(name),
          idempotentHint: !mutations.has(name) && name !== "reentranceTicket",
          openWorldHint: !local.has(name),
        },
      },
      async (args, ctx) => {
        const controller = new AbortController();
        const id = ctx.mcpReq.id;
        const cancel = () => controller.abort();
        ctx.mcpReq.signal?.addEventListener("abort", cancel, { once: true });
        if (ctx.mcpReq.signal?.aborted) cancel();
        if (id !== undefined) active.set(id, controller);
        try {
          return await runtime.invoke(
            name,
            args as Record<string, unknown>,
            controller.signal,
          );
        } catch (error) {
          return {
            ...textResult({
              error: safeError(error, runtime.secrets),
              ...(error instanceof McpError ? { code: error.code,
                ...(error.diagnostic ? { diagnostic: error.diagnostic } : {}) } : {}),
            }),
            isError: true,
          };
        } finally {
          ctx.mcpReq.signal?.removeEventListener("abort", cancel);
          if (id !== undefined) active.delete(id);
        }
      },
    );
  for (const t of runtime.tools)
    register(t.definition.name, t.definition.description, t.validation.schema);
  register(
    "healthcheck",
    "Local runtime/configuration status; does not claim a verified SAP connection",
    z.strictObject({ probeSap: z.boolean().optional() }),
  );
  register(
    "readResultPage",
    "Read the next page of a large previous JSON tool result; use nextOffset, expires in five minutes. No SAP request is repeated.",
    z.strictObject({
      resultId: z.uuid(),
      offset: z.int().min(0).max(4194304).optional(),
      maxCharacters: z.int().min(2).max(16000).optional(),
    }),
  );
  return server;
}
