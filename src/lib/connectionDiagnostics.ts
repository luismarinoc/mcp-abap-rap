import { McpError, ErrorCode } from './errors.js';
import { isRecoveryError, numericHttpStatus } from './sessionRecovery.js';

// Only errors created by the selected core handlers carry a diagnostic into dispatch.
// Keep it outside McpError.data: arbitrary SDK errors may have untrusted data.
const wrappedDiagnostics = new WeakMap<McpError, ReturnType<typeof connectionDiagnostic>>();

export function connectionError(error: unknown, message: string): McpError {
  const wrapped = new McpError(ErrorCode.InternalError, message);
  wrappedDiagnostics.set(wrapped, connectionDiagnostic(error));
  return wrapped;
}

export function wrappedConnectionDiagnostic(error: McpError) {
  return wrappedDiagnostics.get(error);
}

// Never return exception messages, response bodies, headers, URLs or request configuration.
// These may contain credentials, cookies, source code or auth challenges.
export function connectionDiagnostic(error: unknown) {
  const e = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const httpStatus = numericHttpStatus(error);
  const rawCode = e.code;
  const code = typeof rawCode === 'string' && /^(?:EAI_AGAIN|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ECONNABORTED)$/.test(rawCode)
    ? rawCode : undefined;
  const category = isRecoveryError(error) ? 'recovery_required'
    : httpStatus === 401 ? 'authentication'
    : httpStatus === 403 ? 'authorization'
    : httpStatus !== undefined ? 'sap_http'
    : code ? 'network' : 'unknown';
  return { category, ...(httpStatus === undefined ? {} : { status: httpStatus }), ...(code ? { code } : {}) };
}
