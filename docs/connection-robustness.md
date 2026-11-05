# Diagnose and recover an ADT session

When an editing connection receives HTTP 401 or an ADT-recognized CSRF error, ordinary operations on **that connection** stop with `recovery_required`. Inspect SAP for any uncertain write outcome and locks before repeating edits. Call `login` explicitly on the same selected client; successful login clears the gate, but does not reacquire locks. A failed login or `dropSession` alone does not clear the gate: dropping a session does not clear the client's cookies or CSRF token. HTTP 403 alone is `authorization`, not evidence of session expiry.

## Set a transport deadline

Set `SAP_REQUEST_TIMEOUT_MS` in the server's environment before startup. Default: `60000` ms. It must be a positive safe integer no greater than `2147483647` (the supported Axios timer range); invalid values fail configuration before creating ADT connections. This timeout reaches the actual ADT HTTP transport through the public ADT client options, including ordinary authentication. Tune it upward for legitimately long operations; the debugger listen operation keeps its explicit long request timeout. Do not edit `node_modules`. A timeout cannot prove that a write did not happen: inspect SAP before retrying.

## Check availability without mutating the editing session

`healthcheck` without arguments checks only the MCP process and retains its existing `status` and `timestamp` response. To test SAP explicitly, call `healthcheck` with `{ "probeSap": true }`. This starts one authenticated, read-only ADT discovery GET on an **independent stateless session**. The healthcheck response has a five-second deadline covering authentication and the GET; the GET also has a five-second request timeout. The deadline does **not** cancel an underlying login or request that remains pending. A successful probe does not prove that the editing session or its locks remain valid. A failed probe returns a safe category and bounded HTTP status or recognized network code when available; it does not return cookies, credentials, request configuration or SAP response bodies.

Core source read/write, lock/unlock, and login/logout/dropSession failures return MCP `isError` results with a safe `diagnostic`. The session recovery gate also applies to other ordinary ADT client methods and direct `httpClient.request` calls made through the registry proxy. No operation is automatically replayed, no replacement client or stateless editing fallback is created, and requests already pinned to another connection remain independent. Local health and client selection are still available. Source cached for syntax checking belongs to its original pinned connection; client reload begins with an empty cache for the new connection.

These offline checks simulate errors; they do not reproduce the reported third-call incident or prove its root cause. Obtain the exact host error and timestamp to investigate that incident.
