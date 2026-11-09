import { test } from 'node:test';
import assert from 'node:assert/strict';
import { session, mcp, sql } from './helpers.ts';
test('different visitors get distinct real Teller IDs and server-owned request keys', async () => {
  const a = await session(), b = await session();
  const read = async (token: string) => (await (await mcp(token, 'tools/call', { name: 'list_accounts', arguments: {} })).json() as any).result;
  const av = await read(a.tokens.access_token), bv = await read(b.tokens.access_token);
  assert.ok(!av.isError); assert.ok(!bv.isError);
  assert.notEqual(av.structuredContent.accounts[0].id, bv.structuredContent.accounts[0].id);
  assert.notEqual(av.structuredContent.requestSlots[0].requestKey, bv.structuredContent.requestSlots[0].requestKey);
  assert.equal(av.structuredContent.accounts[0].availableBalanceMinor, 89899);
});
test('durable-store loss returns the exact safe tool error and never a partial list', async () => {
  const s = await session();
  sql('ALTER TABLE sample_registry RENAME TO registry_unavailable;');
  try {
    const result = await (await mcp(s.tokens.access_token, 'tools/call', { name: 'list_accounts', arguments: {} })).json() as any;
    assert.equal(result.result.isError, true); assert.equal(result.result.structuredContent.code, 'DEMO_UNAVAILABLE');
    assert.deepEqual(result.result.content, [{ type: 'text', text: 'The demo is unavailable. Try again later.' }]);
  } finally { sql('ALTER TABLE registry_unavailable RENAME TO sample_registry;'); }
});
