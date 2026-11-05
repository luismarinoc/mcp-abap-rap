import { isCsrfError } from 'abap-adt-api';
import type { ADTClient } from 'abap-adt-api';

// Identity is the actual pinned connection, never the selected registry name.
const required = new WeakSet<ADTClient>();
const revisions = new WeakMap<ADTClient, number>();
const marked = new WeakSet<object>();
const MAX_AXIOS_TIMEOUT = 2147483647;

export function requestTimeout(value: string | undefined): number {
  if (value === undefined) return 60000;
  if (!/^[1-9]\d*$/.test(value)) throw new Error('SAP_REQUEST_TIMEOUT_MS must be a positive safe integer within the supported Axios timeout range');
  const timeout = Number(value);
  if (!Number.isSafeInteger(timeout) || timeout > MAX_AXIOS_TIMEOUT) {
    throw new Error('SAP_REQUEST_TIMEOUT_MS must be a positive safe integer within the supported Axios timeout range');
  }
  return timeout;
}

export function recoveryError(): Error {
  const error = new Error('Recovery required');
  marked.add(error);
  return error;
}

export function isRecoveryError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && marked.has(error);
}

export function numericHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const e = error as { status?: unknown; response?: { status?: unknown }; err?: unknown };
  const status = e.status ?? e.response?.status ?? e.err;
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
    ? status : undefined;
}

export function observeFailure(client: ADTClient, error: unknown, version: number): void {
  if (!error || typeof error !== 'object' || recoveryVersion(client) !== version) return;
  if (numericHttpStatus(error) === 401 || (typeof isCsrfError === 'function' && isCsrfError(error))) {
    required.add(client);
    revisions.set(client, version + 1);
    marked.add(error);
  }
}

export function recoveryRequired(client: ADTClient): boolean {
  return required.has(client);
}

export function recoveryVersion(client: ADTClient): number {
  return revisions.get(client) ?? 0;
}

export function loginSucceeded(client: ADTClient, version: number): void {
  if (recoveryVersion(client) === version) {
    required.delete(client);
    // A late response from the previous authenticated session cannot poison this one.
    revisions.set(client, version + 1);
  }
}
