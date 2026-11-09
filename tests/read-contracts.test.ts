import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tools, readTool } from '../apps/mcp/src/tools.ts';
import { TellerClient } from '../apps/mcp/src/teller.ts';
import { originFetch } from '../origin/handler.ts';
import type { Registry } from '../packages/state.ts';
const ids = Array.from({ length: 6 }, () => crypto.randomUUID());
const epoch = crypto.randomUUID();
const registry: Registry = { pool_id: '001', epoch, visitor_id: crypto.randomUUID(), accounts_json: JSON.stringify({ operating: ids[0], reserve: ids[1] }), transfers_json: JSON.stringify({ 'sample-posted': ids[2], 'sample-held': ids[3] }), request_slots_json: JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ reference: `request-${i+1}`, requestKey: crypto.randomUUID(), used: false }))) };
const account = { id: ids[0], currency: 'CAD', status: 'ACTIVE', ledgerBalanceMinor: 99900, availableBalanceMinor: 89899, version: 2, createdAt: '2025-01-01T00:00:00.000000Z' };
const transfer = { id: ids[3], fromAccountId: ids[0], toAccountId: ids[1], amountMinor: 10001, currency: 'CAD', state: 'HELD', reasonCode: null, decisionId: ids[4], approvalId: ids[5], createdAt: account.createdAt, postedAt: null, reversedAt: null };
const secret = 'a'.repeat(64);
const names = ['list_accounts', 'get_account', 'get_transfer'];
const args = [{}, { account: 'operating' }, { reference: 'sample-held' }];
function client(fetcher: (request: Request) => Promise<Response>, sleeps: number[] = []) {
  let now = 0;
  return new TellerClient('http://localhost', secret, epoch, { fetcher, now: () => now, sleep: async n => { sleeps.push(n); now += n; } });
}
test('four exact narrow schemas and all four annotations are listed', () => {
  assert.deepEqual(tools.map(t => t.name), [...names, 'request_transfer']);
  for (const tool of tools.slice(0,3)) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  }
  assert.deepEqual(tools[0].inputSchema, { type: 'object', properties: {}, additionalProperties: false });
});
test('extra fields, unknown aliases, UUID paths and wrong shapes fail before any origin calls', async () => {
  let calls = 0; const upstream = client(async () => { calls++; return Response.json(account); });
  for (const [name, input] of [[names[0], { approved: true }], [names[1], { account: ids[0] }], [names[1], { account: 'operating', visitorId: ids[1] }], [names[2], { reference: 'evil' }], [names[2], []]]) {
    const result = await readTool(name as string, input, registry, upstream);
    assert.equal(result.isError, true); assert.equal(result.structuredContent?.code, 'INVALID_INPUT');
  }
  assert.equal(calls, 0);
});
test('safe upstream error matrix preserves codes, exact messages, and no partial list', async () => {
  const expected = [
    [400, 'UPSTREAM_CONTRACT', ['Teller rejected the account read. The demo needs repair.', 'Teller rejected this account read. The demo needs repair.', 'Teller rejected this transfer read. The demo needs repair.']],
    [404, 'SAMPLE_RESET', ['Accounts changed. Start a new demo session.', 'This account is unavailable. Start a new demo session.', 'No transfer exists for that reference. Check the demo queue.']],
    [401, 'UPSTREAM_AUTH', ['Accounts are unavailable while the demo connection is repaired.', 'This account is unavailable while the demo connection is repaired.', 'This transfer is unavailable while the demo connection is repaired.']],
    [403, 'UPSTREAM_AUTH', ['Accounts are unavailable while the demo connection is repaired.', 'This account is unavailable while the demo connection is repaired.', 'This transfer is unavailable while the demo connection is repaired.']],
    [409, 'UPSTREAM_CONFLICT', ['Accounts could not be read consistently. Try again.', 'This account could not be read consistently. Try again.', 'This transfer could not be read consistently. Check the queue.']],
  ] as const;
  for (const [status, code, messages] of expected) for (let i = 0; i < 3; i++) {
    const result = await readTool(names[i], args[i], registry, client(async request => new URL(request.url).pathname.endsWith('/operating') && i === 0 ? Response.json(account) : new Response('SECRET SQL STACK', { status })));
    assert.equal(result.structuredContent?.code, status === 404 && i === 2 ? 'NOT_FOUND' : code);
    assert.deepEqual(result.content, [{ type: 'text', text: messages[i] }]);
    assert.equal(result.isError, true); assert.equal('accounts' in result.structuredContent!, false);
    assert.ok(!JSON.stringify(result).includes('SECRET'));
  }
});
test('invalid JSON, unsafe numbers, mismatched identities and origin down return unavailable', async () => {
  for (const bad of [async () => new Response('{'), async () => Response.json({ ...account, ledgerBalanceMinor: Number.MAX_SAFE_INTEGER + 1 }), async () => Response.json({ ...account, id: ids[1] }), async () => { throw new Error('SECRET origin down'); }]) {
    const result = await readTool('get_account', args[1], registry, client(bad));
    assert.equal(result.structuredContent?.code, 'UPSTREAM_UNAVAILABLE');
    assert.deepEqual(result.content, [{ type: 'text', text: 'This account is unavailable. Try again later.' }]);
  }
});
test('malformed success and origin-down failures are safe for every read, including a partial account fanout', async () => {
  const messages = ['Accounts are unavailable. Try again later.', 'This account is unavailable. Try again later.', 'This transfer is unavailable. Check the queue or try again later.'];
  for (let i = 0; i < 3; i++) for (const fault of ['json', 'down']) {
    const result = await readTool(names[i], args[i], registry, client(async request => {
      if (i === 0 && new URL(request.url).pathname.endsWith('/operating')) return Response.json(account);
      if (fault === 'json') return new Response('SECRET invalid JSON');
      throw new Error('SECRET connection refused');
    }));
    assert.equal(result.isError, true); assert.equal(result.structuredContent?.code, 'UPSTREAM_UNAVAILABLE');
    assert.deepEqual(result.content, [{ type: 'text', text: messages[i] }]);
    assert.equal('accounts' in result.structuredContent!, false); assert.ok(!JSON.stringify(result).includes('SECRET'));
  }
});
test('origin rejects oversized Teller bodies while streaming and the client does not retry invalid data', async () => {
  let calls = 0, chunks = 0, cancelled = false;
  const pool = { epoch, expiresAt: Date.now() + 60000, pools: [{ poolId: '001', accounts: JSON.parse(registry.accounts_json), transfers: JSON.parse(registry.transfers_json) }] };
  const upstream = async () => {
    calls++;
    return new Response(new ReadableStream({ pull(controller) { chunks++; controller.enqueue(new Uint8Array(16384)); }, cancel() { cancelled = true; } }));
  };
  const result = await readTool(names[1], args[1], registry, client(request => originFetch(request, { secret, apiKey: 'key', pool, maintenance: false, upstream })));
  assert.equal(result.structuredContent?.code, 'UPSTREAM_UNAVAILABLE'); assert.equal(calls, 1);
  assert.ok(cancelled); assert.ok(chunks <= 4);
});
test('bad signing key is refused by the real origin handler and becomes the safe auth error', async () => {
  let calls = 0;
  const pool = { epoch, expiresAt: Date.now() + 60000, pools: [{ poolId: '001', accounts: JSON.parse(registry.accounts_json), transfers: JSON.parse(registry.transfers_json) }] };
  const result = await readTool('get_account', args[1], registry, client(request => originFetch(request, { secret: 'b'.repeat(64), apiKey: 'key', pool, maintenance: false, upstream: async () => { calls++; return Response.json(account); } })));
  assert.equal(result.structuredContent?.code, 'UPSTREAM_AUTH'); assert.equal(calls, 0);
});
test('read retries only transient failures, at most twice, honoring Retry-After and total budget', async () => {
  for (const [status, expectedCalls] of [[400, 1], [401, 1], [403, 1], [404, 1], [409, 1], [429, 3], [500, 3], [503, 3], [418, 1]]) {
    let calls = 0; const sleeps: number[] = [];
    await readTool(names[1], args[1], registry, client(async () => { calls++; return new Response(null, { status }); }, sleeps));
    assert.equal(calls, expectedCalls); assert.deepEqual(sleeps, expectedCalls === 3 ? [250, 1000] : []);
  }
  let calls = 0; const sleeps: number[] = [];
  await readTool(names[1], args[1], registry, client(async () => { calls++; return new Response(null, { status: 429, headers: { 'Retry-After': '20' } }); }, sleeps));
  assert.equal(calls, 1); assert.deepEqual(sleeps, []);
  let malformedCalls = 0;
  await readTool(names[1], args[1], registry, client(async () => { malformedCalls++; return new Response('{'); }));
  assert.equal(malformedCalls, 1);
});
test('known held transfer keeps Teller fields and distinctly reports TELLER_HELD; unused requests have no upstream read', async () => {
  let calls = 0; const upstream = client(async () => { calls++; return Response.json(transfer); });
  const held = await readTool(names[2], args[2], registry, upstream);
  assert.equal(held.isError, undefined); assert.equal(held.structuredContent?.state, 'HELD'); assert.equal(held.structuredContent?.status, 'TELLER_HELD');
  assert.equal(held.structuredContent?.notice, 'Demo data. No real money.');
  const absent = await readTool(names[2], { reference: 'request-1' }, registry, upstream);
  assert.equal(absent.structuredContent?.code, 'NOT_FOUND'); assert.equal(absent._meta?.upstreamStatus,null); assert.equal(calls, 1);
});
test('request transfer reads enforce stored identity and preserve the upstream error mapping',async()=>{
 const {fixture}=await import('./d1.ts'),{createHold}=await import('../packages/gate/holds.ts');const f=await fixture();
 const h=await createHold(f.db,f.props,f.input);const r=await f.db.prepare('SELECT * FROM sample_registry').first<Registry>();h.teller_id=crypto.randomUUID();
 const body=JSON.parse(h.body_json),data={...transfer,id:h.teller_id,fromAccountId:body.fromAccountId,toAccountId:body.toAccountId,amountMinor:body.amountMinor};
 const wrong=await readTool(names[2],{reference:h.reference},r!,client(async()=>Response.json({...data,id:crypto.randomUUID()})),[h]);
 assert.equal(wrong.structuredContent?.code,'UPSTREAM_UNAVAILABLE');
 for(const [status,code] of [[400,'UPSTREAM_CONTRACT'],[401,'UPSTREAM_AUTH'],[403,'UPSTREAM_AUTH'],[404,'NOT_FOUND'],[409,'UPSTREAM_CONFLICT']] as const){
  const result=await readTool(names[2],{reference:h.reference},r!,client(async()=>new Response(null,{status})),[h]);assert.equal(result.structuredContent?.code,code);
 }
});
