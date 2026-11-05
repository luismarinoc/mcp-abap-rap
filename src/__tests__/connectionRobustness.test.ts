jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../handlers/BaseHandler.js', () => require('../handlers/BaseHandler'), { virtual: true });
jest.mock('../lib/sourceCache.js', () => require('../lib/sourceCache'), { virtual: true });
jest.mock('fs', () => ({ __esModule: true, default: { existsSync: jest.fn(() => true), readFileSync: jest.fn(() => JSON.stringify({ porDefecto: 'A', clientes: { A: { url: 'system-A', usuario: 'test', password: 'test' }, B: { url: 'system-B', usuario: 'test', password: 'test' } } })) } }));
const instances: any[] = [];
const probeRequest = jest.fn(async () => ({ status: 200 }));
jest.mock('abap-adt-api', () => ({
  session_types: { stateful: 'stateful', stateless: 'stateless' },
  ADTClient: jest.fn().mockImplementation((url: string) => {
    const client: any = {
      url, stateful: 'stateful',
      getObjectSource: jest.fn(async () => url + ':source'),
      syntaxCheck: jest.fn(async (_url: string, _main: any, code: string) => code),
      setObjectSource: jest.fn(async () => undefined),
      login: jest.fn(async () => ({})), dropSession: jest.fn(async () => undefined),
      get statelessClone() { return { httpClient: { request: probeRequest } }; }
    };
    instances.push(client);
    return client;
  })
}));
import { AbapAdtServer } from '../index';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const saved = { ...process.env };
let server: AbapAdtServer;
let peer: Client;
beforeEach(async () => {
  instances.length = 0;
  probeRequest.mockClear();
  process.env.SAP_URL = 'system-A'; process.env.SAP_USER = 'test'; process.env.SAP_PASSWORD = 'test';
  server = new AbapAdtServer();
  peer = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), peer.connect(b)]);
});
afterEach(async () => { await peer.close(); await server.close(); process.env = { ...saved }; });
const call = async (name: string, args: Record<string, unknown> = {}) => peer.callTool({ name, arguments: args });
const body = (result: any) => JSON.parse(result.content[0].text);

test('local healthcheck is backward compatible and probe uses only independent GET', async () => {
  const local = body(await call('healthcheck'));
  expect(local).toEqual({ status: 'healthy', timestamp: expect.any(String) });
  expect(instances).toHaveLength(0);
  const probe = body(await call('healthcheck', { probeSap: true }));
  expect(probe.sap).toMatchObject({ session: 'independent stateless session', status: 'reachable' });
  expect(instances[0].stateful).toBe('stateful');
  expect(probeRequest).toHaveBeenCalledTimes(1);
  expect(probeRequest).toHaveBeenCalledWith('/sap/bc/adt/discovery', { method: 'GET', timeout: 5000 });
  probeRequest.mockRejectedValueOnce(Object.assign(new Error('cookie SECRET'), { status: 401, code: 'SECRET', config: { password: 'SECRET' } }));
  const failed = body(await call('healthcheck', { probeSap: true }));
  expect(failed.sap).toEqual({ status: 'unreachable', session: 'independent stateless session', diagnostic: { category: 'authentication', status: 401 } });
  expect(JSON.stringify(failed)).not.toContain('SECRET');
  probeRequest.mockRejectedValueOnce(Object.assign(new Error('private source'), { code: 'ECONNRESET' }));
  expect(body(await call('healthcheck', { probeSap: true })).sap.diagnostic).toEqual({ category: 'network', code: 'ECONNRESET' });
});

test('optional probe settles after five seconds even when authentication never completes', async () => {
  jest.useFakeTimers();
  try {
    probeRequest.mockImplementationOnce(() => new Promise(() => {}));
    const pending = call('healthcheck', { probeSap: true });
    let settled = false;
    let payload: any;
    void pending.then(result => { settled = true; payload = body(result); }, () => { settled = true; });
    await jest.advanceTimersByTimeAsync(0);
    expect(probeRequest).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(5000);
    expect(settled).toBe(true);
    expect(payload.sap).toEqual({
      status: 'unreachable', session: 'independent stateless session',
      diagnostic: { category: 'timeout' }
    });
    expect(JSON.stringify(payload)).not.toContain('SECRET');
  } finally {
    jest.useRealTimers();
  }
});

test('connection errors are sanitized and uncertain writes are not replayed', async () => {
  await call('getObjectSource', { objectSourceUrl: '/initialize' });
  const client = instances[0];
  client.getObjectSource.mockRejectedValueOnce(Object.assign(new Error('cookie=SECRET token=SECRET'), { status: 401, code: 'SECRET', config: { password: 'SECRET' } }));
  const result = await call('getObjectSource', { objectSourceUrl: '/same' });
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result)).not.toContain('SECRET');
  client.setObjectSource.mockRejectedValueOnce(Object.assign(new Error('session lost SECRET'), { status: 401 }));
  const write = await call('setObjectSource', { objectSourceUrl: '/same', source: 'x', lockHandle: 'lock' });
  expect(write.isError).toBe(true);
  expect(JSON.stringify(write)).not.toContain('SECRET');
  expect(client.setObjectSource).toHaveBeenCalledTimes(1);
  expect(client.login).not.toHaveBeenCalled();
  expect(client.dropSession).not.toHaveBeenCalled();
});

test('switching while a request is pending retains its pinned client and isolates source cache', async () => {
  let release!: (source: string) => void;
  await call('getObjectSource', { objectSourceUrl: '/initialize' });
  instances[0].getObjectSource.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = call('getObjectSource', { objectSourceUrl: '/same' });
  await new Promise(resolve => setImmediate(resolve));
  await call('usarCliente', { cliente: 'B' });
  release('A source');
  expect(body(await pending).source).toBe('A source');
  const missing = await call('syntaxCheckCode', { url: '/same' });
  expect(missing.isError).toBe(true);
  expect(body(await call('getObjectSource', { objectSourceUrl: '/same' })).source).toBe('system-B:source');
  expect(body(await call('syntaxCheckCode', { url: '/same' })).result).toBe('system-B:source');
  await call('usarCliente', { cliente: 'A' });
  expect(body(await call('syntaxCheckCode', { url: '/same' })).result).toBe('A source');
  await call('recargarClientes');
  const afterReload = await call('syntaxCheckCode', { url: '/same' });
  expect(afterReload.isError).toBe(true);
});

test('explicit login and dropSession remain available and do not run automatically', async () => {
  expect(body(await call('login'))).toEqual({});
  expect(body(await call('dropSession'))).toEqual({ status: 'Session cleared' });
  expect(instances[0].login).toHaveBeenCalledTimes(1);
  expect(instances[0].dropSession).toHaveBeenCalledTimes(1);
  const tools = await peer.listTools();
  expect(tools.tools.map(tool => tool.name)).toEqual(expect.arrayContaining(['login', 'dropSession', 'getObjectSource', 'syntaxCheckCode', 'setObjectSource', 'healthcheck', 'usarCliente']));
});

test('source cache keeps existing read, syntax and write behavior', async () => {
  const read = body(await call('getObjectSource', { objectSourceUrl: '/same' }));
  expect(read.source).toBe('system-A:source');
  const check = body(await call('syntaxCheckCode', { url: '/same' }));
  expect(check).toMatchObject({ status: 'success', usedCachedSource: true, result: 'system-A:source' });
  expect(body(await call('setObjectSource', { objectSourceUrl: '/same', source: 'new', lockHandle: 'lock' }))).toMatchObject({ updated: true });
  expect(body(await call('syntaxCheckCode', { url: '/same' })).result).toBe('new');
});
