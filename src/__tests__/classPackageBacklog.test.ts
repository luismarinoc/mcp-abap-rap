jest.mock('../handlers/BaseHandler.js', () => require('../handlers/BaseHandler'), { virtual: true });

import { ADTClient } from 'abap-adt-api';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ClassHandlers } from '../handlers/ClassHandlers';
import { DdicHandlers } from '../handlers/DdicHandlers';

const classUrl = '/sap/bc/adt/oo/classes/ZCL_A%20B';
const structure = {
  objectUrl: classUrl,
  includes: [{ 'class:includeType': 'main', links: [{ type: 'text/plain', href: 'source/main' }] }]
};

function payload(response: any) {
  return JSON.parse(response.content[0].text);
}

function classSetup() {
  const client = {
    objectStructure: jest.fn().mockResolvedValue(structure),
    classComponents: jest.fn().mockResolvedValue([{ name: 'method' }])
  };
  return { client, handler: new ClassHandlers(client as unknown as ADTClient) };
}

function ddicSetup() {
  const client = {
    packageSearchHelp: jest.fn().mockResolvedValue([{ name: 'ZAPP' }]),
    ddicElement: jest.fn().mockResolvedValue({ name: 'ZFIELD' })
  };
  return { client, handler: new DdicHandlers(client as unknown as ADTClient) };
}

describe('class and package backlog tools through handle', () => {
  test('classIncludes fetches structure before deriving the include map', async () => {
    const { client, handler } = classSetup();
    const result = payload(await handler.handle('classIncludes', { clas: 'ZCL_A B' }));
    expect(result).toEqual({ status: 'success', result: { main: `${classUrl}/source/main` } });
    expect(client.objectStructure).toHaveBeenCalledTimes(1);
    expect(client.objectStructure).toHaveBeenCalledWith(classUrl);
  });

  test('classIncludes returns an empty include result when the structure omits includes', async () => {
    const { client, handler } = classSetup();
    client.objectStructure.mockResolvedValue({ objectUrl: classUrl });
    expect(payload(await handler.handle('classIncludes', { clas: 'ZCL_A B' })))
      .toEqual({ status: 'success', result: {} });
    expect(client.objectStructure).toHaveBeenCalledTimes(1);
  });

  test('classIncludes reports a failed structure fetch without claiming success', async () => {
    const { client, handler } = classSetup();
    client.objectStructure.mockRejectedValue(new Error('not found'));
    await expect(handler.handle('classIncludes', { clas: 'ZCL_A B' }))
      .rejects.toMatchObject({ code: ErrorCode.InternalError, message: expect.stringContaining('Failed to get class includes: not found') });
    expect(client.objectStructure).toHaveBeenCalledTimes(1);
  });

  test('packageSearchHelp rejects invalid types before calling the SDK', async () => {
    const { client, handler } = ddicSetup();
    for (const type of ['packages', 'applicationcomponent', '', 42]) {
      await expect(handler.handle('packageSearchHelp', { type }))
        .rejects.toMatchObject({ code: ErrorCode.InvalidParams, message: expect.stringContaining('applicationcomponents') });
    }
    expect(client.packageSearchHelp).not.toHaveBeenCalled();
  });

  test.each(['applicationcomponents', 'softwarecomponents', 'transportlayers', 'translationrelevances'] as const)(
    'packageSearchHelp passes supported %s to the SDK', async type => {
      const { client, handler } = ddicSetup();
      expect(payload(await handler.handle('packageSearchHelp', { type, name: 'Z*' })))
        .toEqual({ status: 'success', result: [{ name: 'ZAPP' }] });
      expect(client.packageSearchHelp).toHaveBeenCalledTimes(1);
      expect(client.packageSearchHelp).toHaveBeenCalledWith(type, 'Z*');
    }
  );

  test('a supported package help can still fail at the remote endpoint', async () => {
    const { client, handler } = ddicSetup();
    client.packageSearchHelp.mockRejectedValue(new Error('404'));
    await expect(handler.handle('packageSearchHelp', { type: 'applicationcomponents' }))
      .rejects.toMatchObject({ code: ErrorCode.InternalError, message: expect.stringContaining('Failed to get package search help: 404') });
    expect(client.packageSearchHelp).toHaveBeenCalledTimes(1);
  });

  test('legacy classComponents still returns its payload with one SDK call', async () => {
    const { client, handler } = classSetup();
    expect(payload(await handler.handle('classComponents', { url: classUrl })))
      .toEqual({ status: 'success', result: [{ name: 'method' }] });
    expect(client.classComponents).toHaveBeenCalledTimes(1);
    expect(client.classComponents).toHaveBeenCalledWith(classUrl);
  });

  test('legacy ddicElement still forwards options and returns its payload', async () => {
    const { client, handler } = ddicSetup();
    expect(payload(await handler.handle('ddicElement', { path: '/field', getTargetForAssociation: true })))
      .toEqual({ status: 'success', result: { name: 'ZFIELD' } });
    expect(client.ddicElement).toHaveBeenCalledTimes(1);
    expect(client.ddicElement).toHaveBeenCalledWith('/field', true, undefined, undefined);
  });
});
