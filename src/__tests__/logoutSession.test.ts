jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('fs', () => ({ __esModule: true, default: { existsSync: jest.fn(() => true), readFileSync: jest.fn(() => JSON.stringify({ porDefecto: 'A', clientes: { A: { url: 'https://system-a.invalid', usuario: 'test', password: 'test' }, B: { url: 'https://system-b.invalid', usuario: 'test', password: 'test' } } })) } }));
const instances: any[] = [];
jest.mock('abap-adt-api', () => ({
  session_types: { stateful: 'stateful' },
  ADTClient: jest.fn().mockImplementation((origin: any) => {
    const url = origin.base.hostname === 'system-a.invalid' ? 'A' : 'B';
    const client: any = {
      url, loggedin: false,
      getObjectSource: jest.fn(async () => url + ':source'),
      syntaxCheck: jest.fn(async (_url: string, _main: any, code: string) => code),
      setObjectSource: jest.fn(async () => undefined),
      login: jest.fn(async () => ({})), logout: jest.fn(async () => undefined),
      lock: jest.fn(async () => ({ LOCK_HANDLE: 'handle' })),
      get statelessClone() { return { httpClient: { request: jest.fn() } }; }
    };
    instances.push(client);
    return client;
  })
}));
import { ADTClient } from 'abap-adt-api';
import { AbapAdtServer } from './publicServer';
import { RegistroClientes } from '../clients';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const expired = (html: string, status = 400, contentType = 'text/html; charset=utf-8') =>
  Object.assign(new Error('PRIVATE'), { parent: { response: { status, headers: { 'content-type': contentType }, body: html } } });
const page = (text: string) => `<html><head><title>Error</title></head><body><p><span>${text}</span></p></body></html>`;
let server: AbapAdtServer;
let peer: Client;
beforeEach(async () => {
  instances.length = 0;
  server = new AbapAdtServer();
  peer = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), peer.connect(b)]);
});
afterEach(async () => { await peer.close(); await server.close(); });
const call = async (name: string, args: Record<string, unknown> = {}) => peer.callTool({ name, arguments: args });
const body = (result: any) => JSON.parse(result.content[0].text);

test('confirmed expired logout is idempotent, retires only A and leaves stale source and pinned edits unusable', async () => {
  await call('getObjectSource', { objectSourceUrl: '/same' });
  const a = instances[0];
  await call('usarCliente', { cliente: 'B' });
  await call('getObjectSource', { objectSourceUrl: '/same' });
  const b = instances[1];
  await call('usarCliente', { cliente: 'A' });
  a.logout.mockRejectedValueOnce(expired(page('  Session  timed out  ')));
  const result = await call('logout');
  expect(result.isError).not.toBe(true);
  expect(body(result)).toEqual({ status: 'Logged out successfully' });
  expect(a.logout).toHaveBeenCalledTimes(1);
  expect(b.logout).not.toHaveBeenCalled();
  expect(body(await call('clienteActual')).activo).toBe('A');
  const registry = new RegistroClientes();
  const proxy = registry.cliente;
  const old = registry.connectionActual;
  let resume!: () => void;
  const stale = registry.withPinnedConnection(async () => {
    await new Promise<void>(resolve => { resume = resolve; });
    expect((proxy as any).loggedin).toBe(false);
    expect(() => (proxy as any).setObjectSource('/same', 'edit')).toThrow('Recovery required');
  });
  (old as any).logout.mockRejectedValueOnce(expired(page('Session timed out')));
  await registry.withPinnedConnection(async () => proxy.logout());
  expect(registry.connectionActual).not.toBe(old);
  expect((proxy as any).loggedin).toBe(false);
  resume();
  await stale;
  expect(old.setObjectSource).not.toHaveBeenCalled();
  await call('usarCliente', { cliente: 'B' });
  expect(body(await call('syntaxCheckCode', { url: '/same' })).result).toBe('B:source');
  expect(b.getObjectSource).toHaveBeenCalledTimes(1);
  await call('usarCliente', { cliente: 'A' });
  expect((await call('syntaxCheckCode', { url: '/same' })).isError).toBe(true);
  expect(instances.filter(c => c.url === 'A')).toHaveLength(4);
});

test('HTML 400 with only a leading HTTP status label confirms expired logout and isolates the retired identity', async () => {
  await call('getObjectSource', { objectSourceUrl: '/same' });
  const a = instances[0];
  await call('usarCliente', { cliente: 'B' });
  await call('getObjectSource', { objectSourceUrl: '/same' });
  const b = instances[1];
  await call('usarCliente', { cliente: 'A' });
  a.logout.mockRejectedValueOnce(expired(page('400 Session timed out')));
  const result = await call('logout');
  expect(result.isError).not.toBe(true);
  expect(body(result)).toEqual({ status: 'Logged out successfully' });
  expect(a.logout).toHaveBeenCalledTimes(1);
  expect(b.logout).not.toHaveBeenCalled();
  expect(body(await call('clienteActual')).activo).toBe('A');
  expect((await call('syntaxCheckCode', { url: '/same' })).isError).toBe(true);
  await call('usarCliente', { cliente: 'B' });
  expect(body(await call('syntaxCheckCode', { url: '/same' })).result).toBe('B:source');
  expect(b.getObjectSource).toHaveBeenCalledTimes(1);
});

test('nested semantic span with known HTTP 400 label retires only the expired client', async () => {
  await call('getObjectSource', { objectSourceUrl: '/same' });
  const a = instances[0];
  await call('usarCliente', { cliente: 'B' });
  await call('getObjectSource', { objectSourceUrl: '/same' });
  const b = instances[1];
  await call('usarCliente', { cliente: 'A' });
  a.logout.mockRejectedValueOnce(expired('<html><body><p>Other context <span>400: SESSION TIMED OUT</span> advice</p></body></html>'));
  const result = await call('logout');
  expect(result.isError).not.toBe(true);
  expect(body(result)).toEqual({ status: 'Logged out successfully' });
  expect(a.logout).toHaveBeenCalledTimes(1);
  expect(b.logout).not.toHaveBeenCalled();
  expect(body(await call('clienteActual')).activo).toBe('A');
  expect((await call('syntaxCheckCode', { url: '/same' })).isError).toBe(true);
  await call('usarCliente', { cliente: 'B' });
  expect(body(await call('syntaxCheckCode', { url: '/same' })).result).toBe('B:source');
  expect(b.getObjectSource).toHaveBeenCalledTimes(1);
});

test.each([
  ['<p>See <span>400: Session timed out for another reason</span> for details</p>', 400, 'text/html'],
  ['<p>See <span>400: Session timed out</span> for details</p>', 401, 'text/html'],
  ['<script><span>400: Session timed out</span></script><p>Different problem</p>', 400, 'text/html'],
  [page('400 Different problem'), 400, 'text/html'],
  [page('400 Session timed out for another reason'), 400, 'text/html'],
  [page('Different problem'), 400, 'text/html'],
  ['<script>Session timed out</script><p>Different problem</p>', 400, 'text/html'],
  ['<p>See Session timed out for help</p>', 400, 'text/html'],
  [page('Session timed out'), 401, 'text/html'],
  [page('Session timed out'), 403, 'text/html'],
  [page('Session timed out'), 500, 'text/html'],
  [page('Session timed out'), 400, 'application/json'],
  ['<div>Session timed out</div>', 400, 'text/html'],
  [page('Session timed out') + ' '.repeat(16385), 400, 'text/html']
])('unconfirmed logout failure stays an error: case %#', async (html, status, type) => {
  await call('getObjectSource', { objectSourceUrl: '/same' });
  const a = instances[0];
  a.logout.mockRejectedValueOnce(expired(html, status, type));
  const result = await call('logout');
  expect(result.isError).toBe(true);
  expect(body(result)).toMatchObject({ diagnostic: { category: 'unknown' } });
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
  expect(a.logout).toHaveBeenCalledTimes(1);
  expect(instances).toHaveLength(1);
  expect(body(await call('syntaxCheckCode', { url: '/same' })).result).toBe('A:source');
});

test('network and message-only errors cannot confirm an expired logout', async () => {
  await call('getObjectSource', { objectSourceUrl: '/same' });
  const a = instances[0];
  for (const failure of [Object.assign(new Error('Session timed out'), { status: 400 }), Object.assign(new Error('Session timed out'), { code: 'ECONNRESET' })]) {
    a.logout.mockRejectedValueOnce(failure);
    const result = await call('logout');
    expect(result.isError).toBe(true);
    expect(body(result)).toEqual({ error: 'SAP operation failed; outcome may be unknown. Inspect SAP before retrying a write; use dropSession/login explicitly for recovery.', code: -32603,
      diagnostic: 'status' in failure ? { category: 'sap_http', status: 400 } : { category: 'network', code: 'ECONNRESET' } });
  }
  expect(a.logout).toHaveBeenCalledTimes(2);
  expect(instances).toHaveLength(1);
  expect(body(await call('syntaxCheckCode', { url: '/same' })).result).toBe('A:source');
});

test('ordinary successful logout keeps its public response and connection', async () => {
  const result = await call('logout');
  expect(result.isError).not.toBe(true);
  expect(body(result)).toEqual({ status: 'Logged out successfully' });
  expect(instances).toHaveLength(1);
  expect(instances[0].logout).toHaveBeenCalledTimes(1);
});

test('installed SDK public injected HttpClient returns the real HTML 400 wrapper on logout', async () => {
  const sdk = jest.requireActual<typeof import('abap-adt-api')>('abap-adt-api');
  const request = jest.fn(async (options: any) => options.url === '/sap/public/bc/icf/logoff'
    ? { status: 400, statusText: 'Bad Request', headers: { 'content-type': 'text/html', 'x-csrf-token': 'safe-token' }, body: page('Session timed out') }
    : { status: 200, statusText: 'OK', headers: { 'content-type': 'text/html', 'x-csrf-token': 'safe-token' }, body: '' });
  jest.mocked(ADTClient).mockImplementationOnce(() => new sdk.ADTClient({ request }, 'test', 'test') as any);
  const result = await call('logout');
  expect(result.isError).not.toBe(true);
  expect(body(result)).toEqual({ status: 'Logged out successfully' });
  expect(request.mock.calls.filter(([options]) => options.url === '/sap/public/bc/icf/logoff')).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain('safe-token');
});

test('late A logout after reload does not retire the new A or B', async () => {
  const registry = new RegistroClientes();
  const proxy = registry.cliente;
  const old = registry.connectionActual as any;
  let reject!: (error: unknown) => void;
  old.logout.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const pending = registry.withPinnedConnection(() => proxy.logout());
  registry.usar('B');
  const b = registry.connectionActual;
  registry.recargar();
  const replacement = registry.connectionActual;
  (replacement as any).loggedin = true;
  reject(expired(page('Session timed out')));
  await expect(pending).resolves.toBeUndefined();
  expect(registry.connectionActual).toBe(replacement);
  expect(registry.connectionActual).not.toBe(old);
  expect(b).not.toBe(replacement);
  expect((proxy as any).loggedin).toBe(true);
  expect(old.logout).toHaveBeenCalledTimes(1);
});
