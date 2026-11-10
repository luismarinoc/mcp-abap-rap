import { numericHttpStatus } from './sessionRecovery.js';

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
  // Scan each semantic tag separately so an outer paragraph cannot hide its nested span.
  for (const tag of ['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    const elements = visible.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'gi'));
    for (const element of elements) {
      const text = element[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
        .replace(/^400\s*[-:]?\s*/, '');
      if (/^Session timed out$/i.test(text)) return true;
    }
  }
  return false;
}
