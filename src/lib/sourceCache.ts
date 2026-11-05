/**
 * In-memory ABAP source cache partitioned by actual ADT connection identity.
 * Reloading clients creates fresh connections, so old sources cannot leak across reloads.
 */
import type { ADTClient } from 'abap-adt-api';

let cache = new WeakMap<ADTClient, Map<string, string>>();

function entries(client: ADTClient): Map<string, string> {
  let entry = cache.get(client);
  if (!entry) {
    entry = new Map();
    cache.set(client, entry);
  }
  return entry;
}

export const sourceCache = {
  set(url: string, source: string, client: ADTClient): void {
    if (typeof url === 'string' && url.length > 0 && typeof source === 'string') {
      entries(client).set(url, source);
    }
  },
  get(url: string, client: ADTClient): string | undefined {
    return entries(client).get(url);
  },
  has(url: string, client: ADTClient): boolean {
    return entries(client).has(url);
  },
  delete(url: string, client: ADTClient): void {
    entries(client).delete(url);
  },
  clear(client?: ADTClient): void {
    if (client) cache.delete(client);
    else cache = new WeakMap();
  }
};
