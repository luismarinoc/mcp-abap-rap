import { numericHttpStatus } from './sessionRecovery';

/** Only the SDK's HTTP response, not an exception message, can confirm an absent session. */
export function isExpiredLogoutSession(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const outer = error as { parent?: { response?: unknown }; response?: unknown };
  const response = outer.parent?.response ?? outer.response;
  if (!response || typeof response !== 'object') return false;
  const status = numericHttpStatus(response);
  const wrappedStatus = numericHttpStatus(error);
  if (status !== 400 || (wrappedStatus !== undefined && wrappedStatus !== 400)) return false;
  const { headers, body } = response as { headers?: Record<string, unknown>; body?: unknown };
  if (!headers || typeof headers !== 'object' ||
      !Object.entries(headers).some(([key, value]) => key.toLowerCase() === 'content-type' &&
        typeof value === 'string' && /^text\/html(?:\s*;|\s*$)/i.test(value))) return false;
  if (typeof body !== 'string' || body.length > 16384) return false;
  const visible = body.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  // Match an entire visible semantic element, not a snippet of arbitrary HTML or a script.
  const elements = visible.matchAll(/<(p|span|h[1-6])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi);
  for (const element of elements) {
    const text = element[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text === 'Session timed out') return true;
  }
  return false;
}
