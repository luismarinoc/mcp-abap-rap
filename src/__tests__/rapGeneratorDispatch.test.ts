jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('fs', () => ({ __esModule: true, default: {
  existsSync: jest.fn(() => true),
  readFileSync: jest.fn(() => JSON.stringify({ porDefecto: 'TEST', clientes: {
    TEST: { url: 'https://test-system.invalid', usuario: 'test', password: 'test' }
  } }))
} }));
const generator = {
  rapGenValidateInitial: jest.fn(async () => ({ severity: 'error', shortText: 'Fixture: unavailable' }))
};
jest.mock('abap-adt-api', () => ({
  session_types: { stateful: 'stateful', stateless: 'stateless' },
  ADTClient: jest.fn().mockImplementation(() => generator)
}));
import { AbapAdtServer } from './publicServer';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

test('public MCP lists and dispatches createFullRapService without mutation on failed validation', async () => {
  const server = new AbapAdtServer();
  const peer = new Client({ name: 'generator-dispatch-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(a), peer.connect(b)]);
    const tools = await peer.listTools();
    expect(tools.tools.some(tool => tool.name === 'createFullRapService')).toBe(true);
    const result = await peer.callTool({ name: 'createFullRapService', arguments: {
      generatorId: 'uiservice', refObjectUri: '/sap/bc/adt/ddic/tables/zfixture',
      packageName: '$TMP', dryRun: true
    } });
    expect(result.isError).toBe(true);
    expect(generator.rapGenValidateInitial).toHaveBeenCalledTimes(1);
    expect(generator.rapGenValidateInitial).toHaveBeenCalledWith(
      'uiservice', '/sap/bc/adt/ddic/tables/zfixture', '$TMP'
    );
    expect(JSON.parse((result.content as any)[0].text).status).toBe('failure');
  } finally {
    await peer.close();
    await server.close();
  }
});
