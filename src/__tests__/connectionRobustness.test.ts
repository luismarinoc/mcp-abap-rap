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
      login: jest.fn(async () => ({})), logout: jest.fn(async () => undefined),
      dropSession: jest.fn(async () => undefined),
      lock: jest.fn(async () => ({ LOCK_HANDLE: 'handle' })), unLock: jest.fn(async () => undefined),
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
  const write = await call('setObjectSource', { objectSourceUrl: '/same', source: 'x', lockHandle: 'lock' });
  expect(write.isError).toBe(true);
  expect(JSON.stringify(write)).not.toContain('SECRET');
  expect(body(write).diagnostic).toEqual({ category: 'recovery_required' });
  expect(client.setObjectSource).not.toHaveBeenCalled();
  expect(client.login).not.toHaveBeenCalled();
  expect(client.dropSession).not.toHaveBeenCalled();
});

test('read 401 requires explicit login before a later read succeeds', async () => {
  const first = body(await call('getObjectSource', { objectSourceUrl: '/first' }));
  expect(first.status).toBe('success');
  const client = instances[0];
  client.getObjectSource.mockRejectedValueOnce(Object.assign(new Error('token=SECRET'), { response: { status: 401, data: 'SECRET' }, code: 'SECRET', config: { password: 'SECRET' } }));
  const failed = await call('getObjectSource', { objectSourceUrl: '/first' });
  expect(failed.isError).toBe(true);
  expect(body(failed)).toEqual({ error: 'SAP session recovery required; write outcome may be unknown. Inspect SAP before retrying a write; login explicitly and reacquire locks.', code: -32603, diagnostic: { category: 'recovery_required', status: 401 } });
  expect(JSON.stringify(failed)).not.toContain('SECRET');
  expect(body(await call('getObjectSource', { objectSourceUrl: '/second' })).diagnostic).toEqual({ category: 'recovery_required' });
  expect(client.getObjectSource).toHaveBeenCalledTimes(2);
  await call('login');
  expect(body(await call('getObjectSource', { objectSourceUrl: '/second' })).source).toBe('system-A:source');
  expect(client.getObjectSource).toHaveBeenCalledTimes(3);
});

test('login with a void SDK result returns valid safe MCP text and preserves later reads', async () => {
  await call('getObjectSource', { objectSourceUrl: '/initialize' });
  instances[0].login.mockResolvedValueOnce(undefined);
  const result = await call('login');
  expect(result.isError).not.toBe(true);
  expect(typeof (result.content as any)[0].text).toBe('string');
  expect(body(result)).toEqual({ status: 'Logged in successfully' });
  expect(instances[0].login).toHaveBeenCalledTimes(1);
  expect(body(await call('getObjectSource', { objectSourceUrl: '/after-login' })).source).toBe('system-A:source');
});

test('login never exposes a non-void SDK result', async () => {
  await call('getObjectSource', { objectSourceUrl: '/initialize' });
  const client = instances[0];
  client.login.mockResolvedValueOnce({ logged: true, token: 'PRIVATE_TOKEN' });
  const result = await call('login');
  expect(result.isError).not.toBe(true);
  expect(typeof (result.content as any)[0].text).toBe('string');
  expect(body(result)).toEqual({ status: 'Logged in successfully' });
  expect(JSON.stringify(result)).not.toContain('PRIVATE_TOKEN');
  expect(client.login).toHaveBeenCalledTimes(1);
});

test('failed write is classified, never replayed, and recovery is explicit', async () => {
  await call('getObjectSource', { objectSourceUrl: '/initialize' });
  const client = instances[0];
  client.setObjectSource.mockRejectedValueOnce(Object.assign(new Error('SECRET'), { status: 401, config: { token: 'SECRET' } }));
  const failed = await call('setObjectSource', { objectSourceUrl: '/object', source: 'new', lockHandle: 'handle' });
  expect(failed.isError).toBe(true);
  expect(body(failed)).toEqual({ error: 'SAP session recovery required; write outcome may be unknown. Inspect SAP before retrying a write; login explicitly and reacquire locks.', code: -32603, diagnostic: { category: 'recovery_required', status: 401 } });
  expect(JSON.stringify(failed)).not.toContain('SECRET');
  expect(client.setObjectSource).toHaveBeenCalledTimes(1);
  expect(client.login).not.toHaveBeenCalled();
  expect(client.dropSession).not.toHaveBeenCalled();
  expect(body(await call('dropSession'))).toEqual({ status: 'Session cleared' });
  expect(body(await call('getObjectSource', { objectSourceUrl: '/after' })).diagnostic).toEqual({ category: 'recovery_required' });
  expect(body(await call('login'))).toEqual({ status: 'Logged in successfully' });
  expect(body(await call('getObjectSource', { objectSourceUrl: '/after' })).source).toBe('system-A:source');
  expect(client.setObjectSource).toHaveBeenCalledTimes(1);
});

test.each([
  ['lock', { objectUrl: '/object' }, 'lock', { status: 403 }, { category: 'authorization', status: 403 }],
  ['unLock', { objectUrl: '/object', lockHandle: 'handle' }, 'unLock', { code: 'ECONNRESET' }, { category: 'network', code: 'ECONNRESET' }],
  ['login', {}, 'login', { status: 401 }, { category: 'authentication', status: 401 }],
  ['logout', {}, 'logout', { status: 503 }, { category: 'sap_http', status: 503 }],
  ['dropSession', {}, 'dropSession', { code: 'ETIMEDOUT' }, { category: 'network', code: 'ETIMEDOUT' }]
] as const)('%s errors retain safe diagnostic and a later call can succeed', async (tool, args, method, metadata, diagnostic) => {
  await call('getObjectSource', { objectSourceUrl: '/initialize' });
  const client = instances[0];
  client[method].mockRejectedValueOnce(Object.assign(new Error('SECRET'), metadata, { config: { token: 'SECRET' } }));
  const failed = await call(tool, args);
  expect(failed.isError).toBe(true);
  expect(body(failed)).toEqual({ error: tool === 'login' ? 'SAP session recovery required; write outcome may be unknown. Inspect SAP before retrying a write; login explicitly and reacquire locks.' : 'SAP operation failed; outcome may be unknown. Inspect SAP before retrying a write; use dropSession/login explicitly for recovery.', code: -32603, diagnostic: tool === 'login' ? { category: 'recovery_required', status: 401 } : diagnostic });
  expect(JSON.stringify(failed)).not.toContain('SECRET');
  const success = await call(tool, args);
  expect(success.isError).not.toBe(true);
  expect(body(success)).toEqual(tool === 'lock' ? { status: 'success', lockHandle: 'handle', message: 'Object locked successfully' }
    : tool === 'unLock' ? { status: 'success', message: 'Object unlocked successfully' }
    : tool === 'login' ? { status: 'Logged in successfully' } : tool === 'logout' ? { status: 'Logged out successfully' } : { status: 'Session cleared' });
  expect(client[method]).toHaveBeenCalledTimes(2);
});

test('generic MCP errors retain their existing payload without arbitrary data', async () => {
  const failed = await call('nonexistentTool');
  expect(failed.isError).toBe(true);
  expect(body(failed)).toEqual({ error: 'MCP error -32601: Unknown tool: nonexistentTool', code: -32601 });
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
  expect(body(await call('login'))).toEqual({ status: 'Logged in successfully' });
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
