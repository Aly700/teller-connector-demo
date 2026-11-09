import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { fixture } from './d1.ts';
import { createHold, type Hold } from '../packages/gate/holds.ts';
import { consumeTool } from '../packages/limits.ts';
import type { Registry } from '../packages/state.ts';

async function helpers() {
  assert.ok(existsSync('apps/mcp/src/insights-data.ts'), 'session insights helpers exist');
  return import('../apps/mcp/src/insights-data.ts');
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function registry(f: Fixture) {
  return f.raw.prepare('SELECT * FROM sample_registry').get() as unknown as Registry;
}
function account(f: Fixture, alias: 'operating' | 'reserve' = 'operating', balance = 12345) {
  return { id: JSON.parse(registry(f).accounts_json)[alias], account: alias, currency: 'CAD', status: 'ACTIVE', ledgerBalanceMinor: balance, availableBalanceMinor: balance - 100, version: 1, createdAt: new Date(f.now - 60000).toISOString(), sampleData: true, label: 'Sample data', notice: 'Sample data. No real money.' };
}
function result(data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: 'UNTRUSTED RAW CONTENT' }], structuredContent: data };
}
function event(f: Fixture, observations?: unknown, overrides: Record<string, unknown> = {}) {
  const value = { eventId: crypto.randomUUID(), occurredAt: new Date(f.now).toISOString(), visitorId: f.props.visitorId, epoch: f.props.epoch, type: 'READ_OK', tool: 'get_sample_account', ...(observations === undefined ? {} : { accountObservations: observations }), ...overrides };
  f.raw.prepare('INSERT INTO audit_events(id,occurred_at,visitor_id,epoch,tool,code,event_json) VALUES(?,?,?,?,?,?,?)').run(value.eventId, Date.parse(String(value.occurredAt)) || f.now, f.props.visitorId, f.props.epoch, value.tool, value.type, JSON.stringify(value));
  return value;
}
function transfer(f: Fixture, h: Hold, overrides: Record<string, unknown> = {}) {
  const body = JSON.parse(h.body_json);
  return { id: crypto.randomUUID(), fromAccountId: body.fromAccountId, toAccountId: body.toAccountId, amountMinor: body.amountMinor, currency: 'CAD', state: 'POSTED', reasonCode: null, decisionId: null, approvalId: null, createdAt: new Date(h.created_at).toISOString(), postedAt: new Date(h.created_at + 1).toISOString(), reversedAt: null, ...overrides };
}
function saveTransfer(f: Fixture, h: Hold, data: Record<string, unknown>, status = 'POSTED') {
  f.raw.prepare('UPDATE holds SET status=?,teller_id=?,result_json=? WHERE id=?').run(status, String(data.id), JSON.stringify(data), h.id);
}
function replaceHold(f: Fixture, h: Hold, changes: Partial<Hold>) {
  const row = { ...f.raw.prepare('SELECT * FROM holds WHERE id=?').get(h.id), ...changes };
  f.raw.prepare('DELETE FROM holds WHERE id=?').run(h.id);
  const keys = Object.keys(row);
  f.raw.prepare(`INSERT INTO holds(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...Object.values(row));
}

test('account extraction stores only validated account snapshots from matching registry reads', async () => {
  const { extractAccountObservations } = await helpers(), f = await fixture(), data = account(f);
  assert.deepEqual(extractAccountObservations('get_sample_account', result({ ...data, secret: 'DO NOT SAVE' }), registry(f), f.props), [{ account: 'operating', id: data.id, currency: 'CAD', ledgerBalanceMinor: 12345, availableBalanceMinor: 12245, version: 1 }]);
  const both = extractAccountObservations('list_sample_accounts', result({ accounts: [data, account(f, 'reserve')] }), registry(f), f.props);
  assert.deepEqual(both.map(a => a.account), ['operating', 'reserve']);
  for (const name of ['get_sample_transfer', 'request_sample_transfer', 'unknown']) assert.deepEqual(extractAccountObservations(name, result(data), registry(f), f.props), []);
  assert.deepEqual(extractAccountObservations('get_sample_account', { ...result(data), isError: true }, registry(f), f.props), []);
});

test('account extraction rejects unsafe money, malformed accounts and foreign identity', async () => {
  const { extractAccountObservations } = await helpers(), f = await fixture(), data = account(f), r = registry(f);
  const bad = [ { availableBalanceMinor: Number.MAX_SAFE_INTEGER + 1 }, { ledgerBalanceMinor: -1 }, { availableBalanceMinor: 1.25 }, { availableBalanceMinor: 50000 }, { currency: 'USD' }, { version: -1 }, { id: crypto.randomUUID() }, { account: 'private' }, { createdAt: 'bad' }, { status: 'PRIVATE' } ];
  for (const change of bad) assert.deepEqual(extractAccountObservations('get_sample_account', result({ ...data, ...change }), r, f.props), []);
  for (const change of [{ visitor_id: 'someone-else' }, { epoch: crypto.randomUUID() }, { accounts_json: '{' }, { accounts_json: JSON.stringify({ operating: data.id, reserve: data.id }) }]) assert.deepEqual(extractAccountObservations('get_sample_account', result(data), { ...r, ...change }, f.props), []);
  assert.deepEqual(extractAccountObservations('list_sample_accounts', result({ accounts: [data, data] }), r, f.props), []);
  assert.deepEqual(extractAccountObservations('list_sample_accounts', result({ accounts: [data, { ...account(f, 'reserve'), id: crypto.randomUUID() }] }), r, f.props), []);
});

test('old and empty sessions have no invented history, including account creation timestamps', async () => {
  const { getSessionInsights } = await helpers(), f = await fixture();
  event(f);
  f.raw.prepare('INSERT INTO audit_events(id,occurred_at,visitor_id,epoch,tool,code) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(), f.now, f.props.visitorId, f.props.epoch, 'get_sample_account', 'READ_OK');
  const data = await getSessionInsights(f.db, f.props, f.now + 1000);
  assert.equal(data.sources.legacyReadEvents, 2);
  assert.equal(data.sources.observedEvents, 0);
  assert.deepEqual(data.accounts.map(a => a.observations), [[], []]);
  assert.deepEqual(data.accounts.map(a => a.latest), [null, null]);
  assert.deepEqual(data.accounts.map(a => a.historyState), ['empty', 'empty']);
  assert.deepEqual(data.postedTransfers, []);
});

test('one and multiple observations retain exactly their persisted times and balances', async () => {
  const { extractAccountObservations, getSessionInsights } = await helpers(), f = await fixture(), r = registry(f);
  const first = event(f, extractAccountObservations('get_sample_account', result(account(f)), r, f.props));
  let data = await getSessionInsights(f.db, f.props, f.now + 1000);
  assert.equal(data.accounts[0].historyState, 'single');
  assert.equal(data.accounts[0].observations.length, 1);
  assert.equal(data.accounts[0].observations[0].occurredAt, first.occurredAt);
  assert.equal(data.accounts[0].observations[0].availableBalanceMinor, 12245);
  const second = event(f, extractAccountObservations('list_sample_accounts', result({ accounts: [account(f, 'operating', 12000), account(f, 'reserve', 30000)] }), r, f.props), { occurredAt: new Date(f.now + 2000).toISOString(), tool: 'list_sample_accounts' });
  data = await getSessionInsights(f.db, f.props, f.now + 5000);
  assert.deepEqual(data.accounts[0].observations.map(p => [p.eventId, p.occurredAt, p.availableBalanceMinor]), [[first.eventId, first.occurredAt, 12245], [second.eventId, second.occurredAt, 11900]]);
  assert.equal(data.accounts[0].latest?.occurredAt, second.occurredAt);
  assert.equal(data.accounts[0].gaps.betweenObservations, true);
  assert.equal(data.accounts[0].gaps.afterLatestObservation, true);
  assert.equal(data.accounts[1].observations.length, 1);
  assert.equal(data.accounts[1].historyState, 'single');
  assert.equal(data.sources.observedEvents, 2);
});

test('persisted observations revalidate event identity, account identity, time and amounts', async () => {
  const { extractAccountObservations, getSessionInsights } = await helpers(), f = await fixture(), r = registry(f);
  const [observation] = extractAccountObservations('get_sample_account', result(account(f)), r, f.props);
  for (const change of [{ visitorId: 'other' }, { epoch: 'other' }, { eventId: 'invalid' }, { occurredAt: 'bad' }, { type: 'TOOL_REFUSED' }, { tool: 'get_sample_transfer' }]) event(f, [observation], change);
  for (const change of [{ id: crypto.randomUUID() }, { account: 'private' }, { availableBalanceMinor: Number.MAX_SAFE_INTEGER + 1 }, { secret: 'PRIVATE' }]) event(f, [{ ...observation, ...change }]);
  event(f, [observation], { occurredAt: new Date(f.now + 10000).toISOString() });
  event(f, [observation, observation]);
  const valid = event(f, [observation]);
  f.raw.prepare('INSERT INTO audit_events(id,occurred_at,visitor_id,epoch,tool,code,event_json) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(), f.now, f.props.visitorId, f.props.epoch, 'get_sample_account', 'READ_OK', '{broken');
  f.raw.prepare('INSERT INTO audit_events(id,occurred_at,visitor_id,epoch,tool,code,event_json) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(), f.now, 'other', f.props.epoch, 'get_sample_account', 'READ_OK', JSON.stringify({ ...valid, eventId: crypto.randomUUID() }));
  const data = await getSessionInsights(f.db, f.props, f.now + 1000);
  assert.deepEqual(data.accounts[0].observations.map(p => p.eventId), [valid.eventId]);
  assert.ok(data.sources.invalidObservationEvents >= 10);
  const otherEpoch = await getSessionInsights(f.db, { ...f.props, epoch: 'other' }, f.now + 1000);
  assert.deepEqual(otherEpoch.accounts.map(a => a.observations), [[], []]);
  assert.deepEqual(otherEpoch.postedTransfers, []);
});

test('posted transfer markers use exact saved facts and never manufacture balance points', async () => {
  const { getSessionInsights } = await helpers(), f = await fixture(), h = await createHold(f.db, f.props, f.input), saved = transfer(f, h);
  saveTransfer(f, h, saved);
  const duplicate = await createHold(f.db, f.props, { ...f.input, requestKey: f.slots[1].requestKey });
  saveTransfer(f, duplicate, saved);
  const data = await getSessionInsights(f.db, f.props, Date.now() + 1000);
  assert.equal(data.postedTransfers.length, 1);
  assert.equal(data.postedTransfers[0].id, saved.id);
  assert.equal(data.postedTransfers[0].occurredAt, saved.postedAt);
  assert.equal(data.postedTransfers[0].amountMinor, 100);
  assert.deepEqual(data.accounts.map(a => a.observations), [[], []]);
  assert.deepEqual(data.accounts.map(a => a.markers.map(m => [m.direction, m.deltaMinor])), [[['out', -100]], [['in', 100]]]);
  assert.equal(data.requestCounts.posted, 2);
  assert.equal(data.requestCounts.total, 2);
});

test('uncertain, held, denied, foreign and invalid transfers do not become posted markers', async () => {
  const { getSessionInsights } = await helpers(), f = await fixture(), h = await createHold(f.db, f.props, f.input), saved = transfer(f, h);
  for (const status of ['OUTCOME_UNKNOWN', 'DISPATCHING', 'TELLER_HELD', 'TELLER_DENIED', 'DENIED', 'EXPIRED', 'UPSTREAM_REJECTED', 'HELD']) {
    saveTransfer(f, h, saved, status);
    assert.deepEqual((await getSessionInsights(f.db, f.props, Date.now() + 1000)).postedTransfers, []);
  }
  for (const change of [{ state: 'HELD', approvalId: crypto.randomUUID() }, { state: 'PENDING' }, { state: 'REVERSED' }, { fromAccountId: crypto.randomUUID() }, { amountMinor: 101 }, { amountMinor: Number.MAX_SAFE_INTEGER + 1 }, { postedAt: null }, { postedAt: 'bad' }, { postedAt: new Date(f.now + 500000).toISOString() }, { currency: 'USD' }]) {
    saveTransfer(f, h, { ...saved, ...change });
    const data = await getSessionInsights(f.db, f.props, Date.now() + 1000);
    assert.deepEqual(data.postedTransfers, []);
    assert.equal(data.sources.invalidPostedTransfers, 1);
  }
  saveTransfer(f, h, saved);
  replaceHold(f, h, { pool_id: 'other' });
  assert.deepEqual((await getSessionInsights(f.db, f.props, Date.now() + 1000)).postedTransfers, []);
  replaceHold(f, h, { pool_id: '001', visitor_id: 'foreign' });
  const data = await getSessionInsights(f.db, f.props, Date.now() + 1000);
  assert.deepEqual(data.postedTransfers, []);
  assert.equal(data.requestCounts.total, 0);
});

test('contradictory saved facts for one Teller ID withhold that marker', async () => {
  const { getSessionInsights } = await helpers(), f = await fixture();
  const first = await createHold(f.db, f.props, f.input), saved = transfer(f, first);
  saveTransfer(f, first, saved);
  const second = await createHold(f.db, f.props, { ...f.input, amountMinor: 200, requestKey: f.slots[1].requestKey });
  saveTransfer(f, second, transfer(f, second, { id: saved.id }));
  const data = await getSessionInsights(f.db, f.props, Date.now() + 1000);
  assert.deepEqual(data.postedTransfers, []);
  assert.equal(data.sources.invalidPostedTransfers, 2);
  assert.equal(data.requestCounts.posted, 2);
});

test('every stored request has one outcome bucket including expiry and Teller-held', async () => {
  const { getSessionInsights } = await helpers(), f = await fixture(), h = await createHold(f.db, f.props, f.input);
  const pairs = { HELD: 'awaitingApproval', DISPATCHING: 'dispatching', OUTCOME_UNKNOWN: 'outcomeUnknown', POSTED: 'posted', DENIED: 'denied', TELLER_HELD: 'tellerHeld', TELLER_DENIED: 'tellerDenied', UPSTREAM_REJECTED: 'upstreamRejected', EXPIRED: 'expired' } as const;
  for (const [status, key] of Object.entries(pairs)) {
    f.raw.prepare('UPDATE holds SET status=? WHERE id=?').run(status, h.id);
    const { requestCounts } = await getSessionInsights(f.db, f.props, Date.now() + 1000);
    assert.equal(requestCounts.total, 1);
    assert.equal(requestCounts[key], 1);
    assert.equal(Object.entries(requestCounts).filter(([key]) => key !== 'total').reduce((n, [, value]) => n + value, 0), 1);
  }
});

test('budgets report visitor minute and shared UTC day at exact reset boundaries', async () => {
  const { getToolBudget } = await helpers(), f = await fixture();
  const now = Date.UTC(2030, 0, 1, 23, 59, 59, 999);
  let data = await getToolBudget(f.db, f.props, now);
  assert.deepEqual(data.visitorMinute, { used: 0, limit: 30, remaining: 30, resetsAt: '2030-01-02T00:00:00.000Z' });
  assert.deepEqual(data.sharedUtcDay, { used: 0, limit: 10000, remaining: 10000, resetsAt: '2030-01-02T00:00:00.000Z' });
  for (let i = 0; i < 30; i++) assert.equal(await consumeTool(f.db, f.props, 'get_sample_account', now), true);
  assert.equal(await consumeTool(f.db, f.props, 'get_sample_account', now), false);
  data = await getToolBudget(f.db, f.props, now);
  assert.equal(data.visitorMinute.used, 30); assert.equal(data.visitorMinute.remaining, 0);
  assert.equal(data.sharedUtcDay.used, 30); assert.equal(data.sharedUtcDay.remaining, 9970);
  const other = await getToolBudget(f.db, { ...f.props, visitorId: 'other' }, now);
  assert.equal(other.visitorMinute.used, 0); assert.equal(other.sharedUtcDay.used, 30);
  const epoch = await getToolBudget(f.db, { ...f.props, epoch: 'other' }, now);
  assert.equal(epoch.visitorMinute.used, 0); assert.equal(epoch.sharedUtcDay.used, 30);
  const next = await getToolBudget(f.db, f.props, now + 1);
  assert.equal(next.visitorMinute.used, 0); assert.equal(next.sharedUtcDay.used, 0);
  f.raw.prepare("UPDATE tool_limits SET count=10000 WHERE scope='global'").run();
  assert.equal(await consumeTool(f.db, { ...f.props, visitorId: 'other' }, 'get_sample_account', now), false);
  assert.equal((await getToolBudget(f.db, f.props, now)).sharedUtcDay.remaining, 0);
});

test('a minute reset preserves the shared day count and reading budgets consumes nothing', async () => {
  const { getToolBudget } = await helpers(), f = await fixture(), now = Date.UTC(2030, 0, 1, 12, 0, 59, 999);
  await consumeTool(f.db, f.props, 'get_sample_account', now);
  const first = await getToolBudget(f.db, f.props, now), second = await getToolBudget(f.db, f.props, now);
  assert.deepEqual(first, second);
  assert.equal(first.visitorMinute.used, 1);
  const next = await getToolBudget(f.db, f.props, now + 1);
  assert.equal(next.visitorMinute.used, 0);
  assert.equal(next.sharedUtcDay.used, 1);
  assert.equal(next.visitorMinute.resetsAt, '2030-01-01T12:02:00.000Z');
  assert.equal(next.sharedUtcDay.resetsAt, '2030-01-02T00:00:00.000Z');
});
