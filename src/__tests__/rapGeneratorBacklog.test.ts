import { RapHandlers } from '../handlers/RapHandlers';
import type { ADTClient } from 'abap-adt-api';

const refObjectUri = '/sap/bc/adt/ddic/tables/zorders';
const content = {
  metadata: { package: 'ZPKG' }, general: { description: 'Orders' },
  businessObject: { dataModelEntity: { cdsName: 'ZI_Orders' }, behavior: {
    implementationType: 'managed', implementationClass: 'ZBP_Orders', draftTable: 'ZOrdersD'
  } },
  serviceProjection: { name: 'ZC_Orders' }, businessService: {
    serviceDefinition: { name: 'ZUI_Orders' }, serviceBinding: { name: 'ZUI_Orders_V4', bindingType: 'OData V4 - UI' }
  }
};
const objects = [{ uri: '/sap/bc/adt/ddic/ddl/sources/zi_orders', type: 'DDLS/DF', name: 'ZI_Orders', description: 'Orders' }];
const input = { refObjectUri, packageName: 'ZPKG', transport: 'REQ123', content };
const result = (response: any) => JSON.parse(response.content[0].text);

function setup() {
  const calls: string[] = [];
  const client = {
    rapGenValidateInitial: jest.fn(async () => { calls.push('initial'); return { severity: 'ok', shortText: '' }; }),
    rapGenGetContent: jest.fn(async () => { calls.push('defaults'); return structuredClone(content); }),
    rapGenValidateContent: jest.fn(async () => { calls.push('final'); return { severity: 'warning', shortText: 'Check names' }; }),
    rapGenPreview: jest.fn(async () => { calls.push('preview'); return objects; }),
    rapGenGenerate: jest.fn(async () => { calls.push('generate'); return objects; }),
    rapGenPublishService: jest.fn(),
    createObject: jest.fn().mockResolvedValue(undefined),
    findObjectPath: jest.fn().mockResolvedValue([{ 'adtcore:name': 'ZPKG' }, { 'adtcore:name': 'ZCL_DEMO' }]),
    activate: jest.fn().mockResolvedValue({ success: true, messages: [] }),
    httpClient: { request: jest.fn() }
  };
  return { client, calls, handler: new RapHandlers(client as unknown as ADTClient) };
}

describe('createFullRapService public handler', () => {
  test('registration documents inputs and generator choice', () => {
    const { handler } = setup();
    const tool = handler.getTools().find(t => t.name === 'createFullRapService');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toEqual(['refObjectUri', 'packageName']);
    expect(tool!.inputSchema.properties.generatorId.description).toContain('webapiservice');
    expect(tool!.inputSchema.properties.content.description).toContain('RapGeneratorContent');
    expect(tool!.description).toContain('preview');
  });

  test('validates, previews and generates exactly once with supplied content and transport', async () => {
    const { handler, client, calls } = setup();
    const response = await handler.handle('createFullRapService', input);
    expect(response.isError).toBeUndefined();
    expect(result(response)).toMatchObject({ status: 'success', generated: true, preview: objects, objects });
    expect(calls).toEqual(['initial', 'final', 'preview', 'generate']);
    expect(client.rapGenValidateInitial).toHaveBeenCalledWith('uiservice', refObjectUri, 'ZPKG');
    expect(client.rapGenValidateContent).toHaveBeenCalledWith('uiservice', refObjectUri, content);
    expect(client.rapGenPreview).toHaveBeenCalledWith('uiservice', refObjectUri, content);
    expect(client.rapGenGenerate).toHaveBeenCalledWith('uiservice', refObjectUri, 'REQ123', content);
    expect(client.rapGenPublishService).not.toHaveBeenCalled();
  });

  test('dry run fetches and validates defaults, previews but never generates; $TMP needs no transport', async () => {
    const { handler, client, calls } = setup();
    client.rapGenGetContent.mockImplementation(async () => { calls.push('defaults'); return { ...structuredClone(content), metadata: { package: '$TMP' } }; });
    const response = await handler.handle('createFullRapService', { refObjectUri, packageName: '$TMP', generatorId: 'webapiservice', dryRun: true });
    expect(response.isError).toBeUndefined();
    expect(result(response)).toMatchObject({ status: 'success', generated: false, preview: objects });
    expect(calls).toEqual(['initial', 'defaults', 'final', 'preview']);
    expect(client.rapGenGenerate).not.toHaveBeenCalled();
    expect(client.rapGenPublishService).not.toHaveBeenCalled();
  });

  test.each([
    [{ ...input, refObjectUri: 'https://example.com/sap/bc/adt/ddic/tables/zorders' }, 'refObjectUri'],
    [{ ...input, generatorId: 'invalid' }, 'generatorId'],
    [{ ...input, transport: '  ' }, 'transport'],
    [{ ...input, content: { ...content, metadata: { package: 'OTHER' } } }, 'package'],
    [{ ...input, content: { ...content, businessObject: null } }, 'content'],
    [{ ...input, dryRun: 'true' }, 'dryRun'],
    [{ refObjectUri, packageName: 'ZPKG', content }, 'transport']
  ])('rejects malformed local input before network: %s', async (args, diagnostic) => {
    const { handler, client, calls } = setup();
    const response = await handler.handle('createFullRapService', args);
    expect(response.isError).toBe(true);
    expect(result(response)).toMatchObject({ status: 'failure', generated: false });
    expect(JSON.stringify(result(response))).toContain(diagnostic);
    expect(calls).toEqual([]);
    expect(client.rapGenGenerate).not.toHaveBeenCalled();
  });

  test('malformed defaults and failed or unknown validation block mutation', async () => {
    const { handler, client, calls } = setup();
    client.rapGenGetContent.mockImplementationOnce(async () => { calls.push('defaults'); return { ...content, metadata: { package: 'WRONG' } }; });
    const defaults = await handler.handle('createFullRapService', { refObjectUri, packageName: 'ZPKG', transport: 'REQ123' });
    expect(defaults.isError).toBe(true);
    expect(calls).toEqual(['initial', 'defaults']);
    calls.length = 0;
    client.rapGenValidateInitial.mockImplementationOnce(async () => { calls.push('initial'); return { severity: 'error', shortText: 'Package missing' }; });
    const initial = await handler.handle('createFullRapService', input);
    expect(initial.isError).toBe(true);
    expect(result(initial)).toMatchObject({ status: 'failure', generated: false });
    expect(calls).toEqual(['initial']);
    calls.length = 0;
    client.rapGenValidateContent.mockImplementationOnce(async () => { calls.push('final'); return { severity: 'mystery', shortText: 'Unknown' } as any; });
    const final = await handler.handle('createFullRapService', input);
    expect(final.isError).toBe(true);
    expect(calls).toEqual(['initial', 'final']);
    expect(client.rapGenGenerate).not.toHaveBeenCalled();
  });

  test('generation exception and empty result are uncertain failures, no retry or publish', async () => {
    const { handler, client, calls } = setup();
    client.rapGenGenerate.mockImplementationOnce(async () => { calls.push('generate'); throw new Error('secret remote detail'); });
    const failure = await handler.handle('createFullRapService', input);
    expect(failure.isError).toBe(true);
    expect(result(failure)).toMatchObject({ status: 'failure', generated: false, uncertain: true, preview: objects });
    expect(JSON.stringify(failure)).not.toContain('secret remote detail');
    expect(calls).toEqual(['initial', 'final', 'preview', 'generate']);
    client.rapGenGenerate.mockResolvedValueOnce([]);
    const empty = await handler.handle('createFullRapService', input);
    expect(empty.isError).toBe(true);
    expect(result(empty)).toMatchObject({ status: 'failure', uncertain: true, generated: false });
    expect(client.rapGenGenerate).toHaveBeenCalledTimes(2);
    expect(client.rapGenPublishService).not.toHaveBeenCalled();
  });

  test('existing createAndActivate still creates and activates with the old envelope', async () => {
    const { handler, client } = setup();
    const response = await handler.handle('createAndActivate', { objtype: 'CLAS/OC', name: 'ZCL_DEMO', parentName: 'ZPKG', description: 'Demo' });
    expect(result(response)).toEqual({ status: 'success', object: 'ZCL_DEMO', objtype: 'CLAS/OC', existed: false,
      steps: ['created', 'activated'], activated: true, messages: [] });
    expect(client.createObject).toHaveBeenCalledTimes(1);
    expect(client.activate).toHaveBeenCalledTimes(1);
  });
});
