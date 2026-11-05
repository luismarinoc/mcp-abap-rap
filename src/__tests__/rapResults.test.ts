import { RapHandlers } from '../handlers/RapHandlers';
import type { ADTClient } from 'abap-adt-api';

const objectUrl = '/sap/bc/adt/oo/classes/zcl_demo';
const sourceUrl = `${objectUrl}/source/main`;
const base = { objtype: 'CLAS/OC', name: 'ZCL_DEMO', parentName: 'ZPKG', description: 'Demo' };

function setup() {
  const client = {
    createObject: jest.fn().mockResolvedValue(undefined),
    findObjectPath: jest.fn().mockResolvedValue([{ 'adtcore:name': 'ZPKG' }, { 'adtcore:name': 'ZCL_DEMO' }]),
    lock: jest.fn().mockResolvedValue({ LOCK_HANDLE: 'handle' }),
    setObjectSource: jest.fn().mockResolvedValue(undefined),
    unLock: jest.fn().mockResolvedValue(undefined),
    // abap-adt-api ActivationResult: success, messages, inactive (activate.d.ts).
    activate: jest.fn().mockResolvedValue({ success: true, messages: [], inactive: [] }),
    httpClient: { request: jest.fn().mockResolvedValue({ status: 200, body: 'OK' }) }
  };
  return { handler: new RapHandlers(client as unknown as ADTClient), client };
}

function payload(result: any) {
  return JSON.parse(result.content[0].text);
}

const text = (error: unknown) => String(error);

describe('RAP result semantics via handle', () => {
  test('failed activation returns MCP error, non-success status, diagnostics and no retry of mutation', async () => {
    const { handler, client } = setup();
    client.activate.mockResolvedValue({ success: false, messages: [{ type: 'E', shortText: 'Syntax error' }], inactive: [] });
    const result = await handler.handle('createAndActivate', { ...base, source: 'CLASS zcl_demo DEFINITION. ENDCLASS.' });
    expect(result.isError).toBe(true);
    expect(payload(result)).toEqual({
      status: 'failure', object: 'ZCL_DEMO', objtype: 'CLAS/OC', existed: false,
      steps: ['created', 'source written', 'ACTIVATION FAILED'], activated: false, messages: ['E: Syntax error']
    });
    expect(client.createObject).toHaveBeenCalledTimes(1);
    expect(client.setObjectSource).toHaveBeenCalledTimes(1);
    expect(client.activate).toHaveBeenCalledTimes(1);
  });

  test('failed unlock after successful write is reported, not a successful source result', async () => {
    const { handler, client } = setup();
    client.unLock.mockRejectedValue(new Error('sensitive unlock detail'));
    await expect(handler.handle('setSourceByName', { ...base, source: 'source' }))
      .rejects.toThrow('Source unlock failed after write');
    expect(client.setObjectSource).toHaveBeenCalledTimes(1);
    expect(client.unLock).toHaveBeenCalledWith(objectUrl, 'handle');
    expect(client.lock).toHaveBeenCalledTimes(1);
  });

  test('write plus unlock failure keeps write failure primary and reports cleanup without sensitive details', async () => {
    const { handler, client } = setup();
    client.setObjectSource.mockRejectedValue(new Error('secret write diagnostic'));
    client.unLock.mockRejectedValue(new Error('secret unlock diagnostic'));
    let error: unknown;
    try { await handler.handle('setSourceByName', { ...base, source: 'source' }); } catch (e) { error = e; }
    expect(error).toBeDefined();
    expect(text(error)).toContain('Source write failed');
    expect(text(error)).toContain('unlock also failed');
    expect(text(error)).not.toContain('secret');
    expect(client.setObjectSource).toHaveBeenCalledTimes(1);
    expect(client.unLock).toHaveBeenCalledTimes(1);
    expect(client.activate).not.toHaveBeenCalled();
  });

  test('ordinary create and registration result remain unchanged', async () => {
    const { handler, client } = setup();
    expect(payload(await handler.handle('createObjectSafe', base))).toEqual({
      status: 'success', created: 'ZCL_DEMO', objtype: 'CLAS/OC', package: 'ZPKG', objectUrl
    });
    expect(payload(await handler.handle('checkObjectRegistered', base))).toEqual({
      status: 'success', registered: true, package: 'ZPKG', objectUrl
    });
    expect(client.createObject).toHaveBeenCalledTimes(1);
  });

  test('ordinary source write and create/activate retain their payloads and single writes', async () => {
    const { handler, client } = setup();
    const source = 'CLASS zcl_demo DEFINITION. ENDCLASS.';
    expect(payload(await handler.handle('setSourceByName', { ...base, source }))).toEqual({
      status: 'success', written: sourceUrl, bytes: source.length
    });
    expect(payload(await handler.handle('createAndActivate', { ...base, source }))).toEqual({
      status: 'success', object: 'ZCL_DEMO', objtype: 'CLAS/OC', existed: false,
      steps: ['created', 'source written', 'activated'], activated: true, messages: []
    });
    expect(client.setObjectSource).toHaveBeenCalledTimes(2);
    expect(client.activate).toHaveBeenCalledTimes(1);
  });
});
