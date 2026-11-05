// Never return exception messages, response bodies, headers, URLs or request configuration.
// These may contain credentials, cookies, source code or auth challenges.
export function connectionDiagnostic(error: unknown) {
  const e = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const response = e.response && typeof e.response === 'object'
    ? e.response as Record<string, unknown> : {};
  const status = e.status ?? response.status;
  const httpStatus = typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
    ? status : undefined;
  const rawCode = e.code;
  const code = typeof rawCode === 'string' && /^(?:EAI_AGAIN|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ECONNABORTED)$/.test(rawCode)
    ? rawCode : undefined;
  const category = httpStatus === 401 || httpStatus === 403 ? 'authentication'
    : httpStatus !== undefined ? 'sap_http'
    : code ? 'network' : 'unknown';
  return { category, ...(httpStatus === undefined ? {} : { status: httpStatus }), ...(code ? { code } : {}) };
}
