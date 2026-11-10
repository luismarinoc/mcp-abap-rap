jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('fs', () => ({ __esModule: true, default: { existsSync: jest.fn(() => true), readFileSync: jest.fn(() => JSON.stringify({ porDefecto: 'A', clientes: { A: { url: 'https://system-a.invalid', usuario: 'test', password: 'test' }, B: { url: 'https://system-b.invalid', usuario: 'test', password: 'test' } } })) } }));
const clients: any[] = [];
jest.mock('abap-adt-api', () => ({
  session_types: { stateful: 'stateful', stateless: 'stateless' },
  isCsrfError: (e: any) => e?.typeID === Symbol.for('test-csrf'),
  // Real AdtHTTP imports the package index to check whether an error is a login error.
  isLoginError: (e: any) => e?.status === 401 || e?.typeID === Symbol.for('BAD CSRF'),
  ADTClient: jest.fn().mockImplementation((origin: any) => {
    const url = origin.base.hostname === 'system-a.invalid' ? 'system-A' : 'system-B';
    const client: any = {
      url, stateful: 'stateful',
      getObjectSource: jest.fn(async () => url + ':source'),
      isProposalMessage: jest.fn((value: string) => value === 'proposal'),
      setObjectSource: jest.fn(async () => undefined),
      login: jest.fn(async () => ({})), logout: jest.fn(async () => undefined),
      dropSession: jest.fn(async () => undefined),
      get httpClient() { return { request: client.request }; },
      request: jest.fn(async () => ({ body: 'ok', status: 200 }))
    };
    clients.push(client);
    return client;
  })
}));
import { ADTClient } from 'abap-adt-api';
import { AbapAdtServer } from './publicServer';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { RegistroClientes } from '../clients';
import { Runtime } from '../server';

const saved = { ...process.env };
let server: AbapAdtServer;
let peer: Client;
const body = (result: any) => JSON.parse(result.content[0].text);
const call = (name: string, args: Record<string, unknown> = {}) => peer.callTool({ name, arguments: args });
const read = () => call('getObjectSource', { objectSourceUrl: '/test' });
const write = () => call('setObjectSource', { objectSourceUrl: '/test', source: 'new', lockHandle: 'held' });
const fail = (status: number) => Object.assign(new Error('secret'), { status, response: { data: 'secret' } });

beforeEach(async () => {
  clients.length = 0;
  process.env.SAP_URL = 'system-A'; process.env.SAP_USER = 'test'; process.env.SAP_PASSWORD = 'test';
  delete process.env.SAP_REQUEST_TIMEOUT_MS;
  server = new AbapAdtServer();
  peer = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), peer.connect(b)]);
});
afterEach(async () => { await peer.close(); await server.close(); process.env = { ...saved }; });

test('401 failed write runs once, gates later edits before backend, and only successful explicit login recovers', async () => {
  await read();
  const client = clients[0];
  client.setObjectSource.mockRejectedValueOnce(fail(401));
  const failed = await write();
  expect(failed.isError).toBe(true);
  expect(body(failed).diagnostic).toEqual({ category: 'recovery_required', status: 401 });
  expect(JSON.stringify(failed)).not.toContain('secret');
  expect(client.setObjectSource).toHaveBeenCalledTimes(1);
  expect(client.login).not.toHaveBeenCalled();
  expect(client.dropSession).not.toHaveBeenCalled();
  const rejected = await write();
  expect(rejected.isError).toBe(true);
  expect(body(rejected).diagnostic).toEqual({ category: 'recovery_required' });
  expect(body(rejected).error).toMatch(/Inspect SAP.*lock/i);
  expect(client.setObjectSource).toHaveBeenCalledTimes(1);
  client.login.mockRejectedValueOnce(fail(401));
  expect((await call('login')).isError).toBe(true);
  expect(body(await write()).diagnostic.category).toBe('recovery_required');
  expect(body(await call('dropSession'))).toEqual({ status: 'Session cleared' });
  expect(body(await write()).diagnostic.category).toBe('recovery_required');
  expect(client.setObjectSource).toHaveBeenCalledTimes(1);
  expect(body(await call('login'))).toEqual({ status: 'Logged in successfully' });
  expect(body(await write())).toMatchObject({ status: 'success', updated: true });
  expect(client.setObjectSource).toHaveBeenCalledTimes(2);
});

test('401 read and public recognized CSRF gate ordinary operations; 403 alone does not', async () => {
  await read();
  const client = clients[0];
  client.getObjectSource.mockRejectedValueOnce(fail(403));
  expect(body(await read()).diagnostic).toEqual({ category: 'authorization', status: 403 });
  expect(body(await read()).source).toBe('system-A:source');
  const csrf = Object.assign(new Error('secret'), { typeID: Symbol.for('test-csrf') });
  client.getObjectSource.mockRejectedValueOnce(csrf);
  expect(body(await read()).diagnostic).toEqual({ category: 'recovery_required' });
  expect(body(await read()).diagnostic).toEqual({ category: 'recovery_required' });
  expect(client.getObjectSource).toHaveBeenCalledTimes(4);
  expect(body(await call('healthcheck'))).toEqual({ status: 'healthy', timestamp: expect.any(String),
    sapConfigured: true, sapConnectionVerified: false, sessionRecoveryRequired: true, tools: 139 });
});

test('pinned A failure while B active does not gate B and remains attached to A', async () => {
  await read();
  let rejectA!: (e: unknown) => void;
  clients[0].getObjectSource.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectA = reject; }));
  const pending = read();
  await new Promise(resolve => setImmediate(resolve));
  await call('usarCliente', { cliente: 'B' });
  rejectA(fail(401));
  expect(body(await pending).diagnostic).toEqual({ category: 'recovery_required', status: 401 });
  expect(body(await read()).source).toBe('system-B:source');
  expect(body(await write()).updated).toBe(true);
  await call('usarCliente', { cliente: 'A' });
  expect(body(await write()).diagnostic.category).toBe('recovery_required');
  expect(clients[0].setObjectSource).not.toHaveBeenCalled();
});

test('raw public httpClient.request failures mark the same pinned connection', async () => {
  const registry = new RegistroClientes();
  const proxy = registry.cliente;
  const actual: any = registry.connectionActual;
  actual.request.mockRejectedValueOnce(fail(401));
  await expect(proxy.httpClient.request('/test', { method: 'GET' })).rejects.toMatchObject({ status: 401 });
  expect(() => proxy.httpClient.request('/test', { method: 'GET' })).toThrow('Recovery required');
  expect(actual.request).toHaveBeenCalledTimes(1);
});

test('numeric ADT err 401 requires recovery; numeric 403 is authorization', async () => {
  await read();
  const client = clients[0];
  client.getObjectSource.mockRejectedValueOnce(Object.assign(new Error('SECRET'), { err: 403 }));
  const forbidden = await read();
  expect(body(forbidden).diagnostic).toEqual({ category: 'authorization', status: 403 });
  expect(JSON.stringify(forbidden)).not.toContain('SECRET');
  expect(body(await read()).source).toBe('system-A:source');
  client.setObjectSource.mockRejectedValueOnce(Object.assign(new Error('SECRET'), { err: 401 }));
  const rejected = await write();
  expect(body(rejected).diagnostic).toEqual({ category: 'recovery_required', status: 401 });
  expect(JSON.stringify(rejected)).not.toContain('SECRET');
  expect(body(await write()).diagnostic).toEqual({ category: 'recovery_required' });
  expect(client.setObjectSource).toHaveBeenCalledTimes(1);
  expect(client.login).not.toHaveBeenCalled();
});

test('installed ADT client with public injected HttpClient exposes err 401 on an ordinary stateful read', async () => {
  const sdk = jest.requireActual<typeof import('abap-adt-api')>('abap-adt-api');
  const request = jest.fn(async (options: any) => ({
    body: options.url === '/sap/bc/adt/programs/expired' ? '' : 'source',
    status: options.url === '/sap/bc/adt/programs/expired' ? 401 : 200,
    statusText: options.url === '/sap/bc/adt/programs/expired' ? 'Unauthorized' : 'OK',
    headers: { 'x-csrf-token': 'safe-token' }
  }));
  jest.mocked(ADTClient).mockImplementationOnce(() => new sdk.ADTClient({ request }, 'test', 'test') as any);
  expect(body(await call('getObjectSource', { objectSourceUrl: '/sap/bc/adt/programs/first' })).source).toBe('source');
  const expired = await call('getObjectSource', { objectSourceUrl: '/sap/bc/adt/programs/expired' });
  expect(body(expired).diagnostic).toEqual({ category: 'recovery_required', status: 401 });
  expect(JSON.stringify(expired)).not.toContain('safe-token');
  expect(body(await write()).diagnostic).toEqual({ category: 'recovery_required' });
  expect(request).toHaveBeenCalledTimes(3); // login, ordinary read, expired read; no replay or gated write
});

test('late old-session failure does not poison a successfully reauthenticated client; new failures still do', async () => {
  await read();
  const client = clients[0];
  let rejectOld!: (reason: unknown) => void;
  client.getObjectSource.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
  const pending = read();
  await new Promise(resolve => setImmediate(resolve));
  const concurrent = await call('login');
  expect(concurrent.isError).toBe(true);
  expect(client.login).not.toHaveBeenCalled();
  rejectOld(Object.assign(new Error('SECRET'), { err: 401 }));
  const oldFailure = await pending;
  expect(body(oldFailure).diagnostic).toEqual({ category: 'recovery_required', status: 401 });
  expect(JSON.stringify(oldFailure)).not.toContain('SECRET');
  expect(body(await write()).diagnostic).toEqual({ category: 'recovery_required' });
  expect(client.setObjectSource).not.toHaveBeenCalled();
  expect(body(await call('login'))).toEqual({ status: 'Logged in successfully' });
  expect(body(await write()).updated).toBe(true);
  expect(client.setObjectSource).toHaveBeenCalledTimes(1);
  client.setObjectSource.mockRejectedValueOnce(Object.assign(new Error('SECRET'), { err: 401 }));
  expect(body(await write()).diagnostic).toEqual({ category: 'recovery_required', status: 401 });
  expect(client.setObjectSource).toHaveBeenCalledTimes(2);
  expect(client.login).toHaveBeenCalledTimes(1);
});

test('synchronous public method preserves boolean result for true and false', () => {
  const registry = new RegistroClientes();
  const client = registry.cliente;
  expect((client as any).isProposalMessage('proposal')).toBe(true);
  expect((client as any).isProposalMessage('not a proposal')).toBe(false);
  expect((registry.connectionActual as any).isProposalMessage).toHaveBeenCalledTimes(2);
});

test('bounded modern runtime rejects invalid timeout before constructing a client', async () => {
  await read();
  const constructed = jest.mocked(ADTClient).mock.calls.length;
  for (const invalid of ['0', '-1', '1.5', 'NaN', '9007199254740992', '2147483648', '', '99', '120001']) {
    expect(() => new Runtime({ ...process.env, SAP_REQUEST_TIMEOUT_MS: invalid })).toThrow('SAP_REQUEST_TIMEOUT_MS');
    expect(jest.mocked(ADTClient).mock.calls).toHaveLength(constructed);
  }
  const modern = new Runtime({ ...process.env, SAP_REQUEST_TIMEOUT_MS: '90000' });
  await modern.close();
  expect(jest.mocked(ADTClient).mock.calls).toHaveLength(constructed);
});
