jest.mock('../handlers/BaseHandler.js', () => require('../handlers/BaseHandler'), { virtual: true });
import { ObjectHandlers } from '../handlers/ObjectHandlers';
import type { ADTClient } from 'abap-adt-api';

const types = [
  { type: 'CLAS', name: 'Class', description: 'ABAP class', usedBy: [] },
  { type: 'DEVC', name: 'Package', description: 'Development container', usedBy: [] },
  { type: 'FUGR', name: 'Function group', description: 'Reusable logic', usedBy: [] }
];
const rows = Array.from({ length: 120 }, (_, i) => ({ 'adtcore:name': `Z${i}`, 'adtcore:type': 'CLAS/OC', 'adtcore:uri': `/object/${i}` }));

function setup() {
  const client = {
    objectTypes: jest.fn().mockResolvedValue(types),
    searchObject: jest.fn().mockResolvedValue(rows),
    objectStructure: jest.fn().mockResolvedValue({ name: 'ZCL' }),
    findObjectPath: jest.fn().mockResolvedValue([{ name: 'ZCL' }]),
    reentranceTicket: jest.fn().mockResolvedValue('ticket')
  };
  return { handler: new ObjectHandlers(client as unknown as ADTClient), client };
}
const body = (value: any) => JSON.parse(value.content[0].text);

const expected = (field: string, value: unknown) => types.filter(type =>
  String(type[field as keyof typeof type]).toLowerCase().includes(String(value).toLowerCase()));

describe('object discovery through handle', () => {
  test.each([
    ['type', 'las'], ['name', 'ACK'], ['description', 'usable']
  ])('objectTypes filter matches %s case-insensitively', async (_field, filter) => {
    const { handler, client } = setup();
    const result = await handler.handle('objectTypes', { filter });
    expect(result).toEqual({ content: [{ type: 'text', text: JSON.stringify({
      status: 'success', types: expected(_field, filter), message: 'Object types retrieved successfully'
    }, null, 2) }] });
    expect(client.objectTypes).toHaveBeenCalledTimes(1);
  });

  test('objectTypes no-arg retains the exact legacy response', async () => {
    const { handler, client } = setup();
    expect(await handler.handle('objectTypes', {})).toEqual({ content: [{ type: 'text', text: JSON.stringify({
      status: 'success', types, message: 'Object types retrieved successfully'
    }, null, 2) }] });
    expect(client.objectTypes).toHaveBeenCalledTimes(1);
  });

  test.each([
    [{ offset: 5, pageSize: 3 }, 8, 5, 3, rows.slice(5, 8)],
    [{ offset: 115 }, 215, 115, 100, rows.slice(115)],
    [{ pageSize: 2 }, 2, 0, 2, rows.slice(0, 2)],
    [{ offset: 0, pageSize: 10000 }, 10000, 0, 10000, rows]
  ])('searchObject uses bounded SDK prefix then slices %j', async (paging, prefix, offset, pageSize, results) => {
    const { handler, client } = setup();
    const result = await handler.handle('searchObject', { query: 'Z*', objType: 'CLAS', ...paging });
    expect(result).toEqual({ content: [{ type: 'text', text: JSON.stringify({
      status: 'success', results, message: 'Object search completed successfully',
      paging: { offset, pageSize, returned: results.length }
    }, null, 2) }] });
    expect(client.searchObject).toHaveBeenCalledTimes(1);
    expect(client.searchObject).toHaveBeenCalledWith('Z*', 'CLAS', prefix);
  });

  test('searchObject no paging keeps exact legacy response and max call', async () => {
    const { handler, client } = setup();
    expect(await handler.handle('searchObject', { query: 'Z*', objType: 'CLAS', max: 7 })).toEqual({
      content: [{ type: 'text', text: JSON.stringify({
        status: 'success', results: rows, message: 'Object search completed successfully'
      }, null, 2) }]
    });
    expect(client.searchObject).toHaveBeenCalledWith('Z*', 'CLAS', 7);
    await handler.handle('searchObject', { query: 'Z*' });
    expect(client.searchObject).toHaveBeenLastCalledWith('Z*', undefined, undefined);
  });

  test.each([
    [{ offset: -1 }, 'offset'], [{ offset: 0.5 }, 'offset'], [{ offset: Infinity }, 'offset'],
    [{ offset: '2' }, 'offset'], [{ pageSize: 0 }, 'pageSize'], [{ pageSize: -1 }, 'pageSize'],
    [{ pageSize: 1.5 }, 'pageSize'], [{ pageSize: NaN }, 'pageSize'],
    [{ offset: 10000, pageSize: 1 }, '10000'], [{ pageSize: 10001 }, '10000'],
    [{ offset: 1, max: 10 }, 'max']
  ])('invalid paging %j rejects before network', async (paging, message) => {
    const { handler, client } = setup();
    await expect(handler.handle('searchObject', { query: 'Z*', ...paging }))
      .rejects.toThrow(message);
    expect(client.searchObject).not.toHaveBeenCalled();
  });

  test('untouched object commands retain their public responses', async () => {
    const { handler, client } = setup();
    expect(body(await handler.handle('objectStructure', { objectUrl: '/object', version: 'active' }))).toEqual({
      status: 'success', structure: { name: 'ZCL' }, message: 'Object structure retrieved successfully'
    });
    expect(client.objectStructure).toHaveBeenCalledWith('/object', 'active');
    expect(body(await handler.handle('findObjectPath', { objectUrl: '/object' }))).toEqual({
      status: 'success', path: [{ name: 'ZCL' }], message: 'Object path found successfully'
    });
    expect(client.findObjectPath).toHaveBeenCalledWith('/object');
    expect(body(await handler.handle('reentranceTicket', {}))).toEqual({
      status: 'success', ticket: 'ticket', message: 'Reentrance ticket retrieved successfully'
    });
    expect(client.reentranceTicket).toHaveBeenCalledTimes(1);
  });
});
