import assert from 'node:assert/strict';
import fixture from '../fixtures/sample.json' with { type: 'json' };
import { SAMPLE, type Pool } from '../packages/sample.ts';

export function nextReset(now = Date.now()): number {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  for (let time = Math.floor(now / 60000) * 60000 + 60000; time <= now + 26 * 3600000; time += 60000) {
    if (formatter.format(new Date(time)) === '03:00') return time;
  }
  throw new Error('Reset time unavailable');
}
export async function seed(): Promise<Pool> {
  // Called only after reset has stopped Teller and recreated the dedicated database.
  async function call(path: string, body?: unknown, key?: string) {
    const response = await fetch('http://127.0.0.1:18080' + path, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { 'X-API-Key': process.env.TELLER_API_KEY!, 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`Sample seed failed with HTTP ${response.status}; reset required, no automatic retry`);
    return response.json() as Promise<Record<string, any>>;
  }
  const epoch = crypto.randomUUID();
  const policy = await call('/policies', { name: SAMPLE.notice, version: 1 });
  for (const rule of fixture.rules) await call(`/policies/${policy.id}/rules`, rule);
  const pools: Pool['pools'] = [];
  for (let i = 1; i <= fixture.poolSize; i++) {
    const poolId = String(i).padStart(3, '0');
    const operating = await call('/accounts', { currency: fixture.currency });
    const reserve = await call('/accounts', { currency: fixture.currency });
    for (const account of [operating, reserve]) await call(`/accounts/${account.id}/deposits`, { amountMinor: fixture.depositMinor });
    const body = { fromAccountId: operating.id, toAccountId: reserve.id, currency: fixture.currency, initiatedBy: `sample-seed-${poolId}` };
    const posted = await call('/transfers', { ...body, amountMinor: fixture.postedMinor }, `seed:${epoch}:${poolId}:posted`);
    const held = await call('/transfers', { ...body, amountMinor: fixture.heldMinor }, `seed:${epoch}:${poolId}:held`);
    assert.equal(posted.state, 'POSTED'); assert.equal(held.state, 'HELD');
    for (const [alias, account] of Object.entries({ operating, reserve })) {
      const actual = await call(`/accounts/${account.id}`);
      const expected = fixture.expected[alias as 'operating' | 'reserve'];
      assert.equal(actual.ledgerBalanceMinor, expected.ledgerBalanceMinor);
      assert.equal(actual.availableBalanceMinor, expected.availableBalanceMinor);
    }
    pools.push({ ...SAMPLE, poolId, accounts: { operating: operating.id, reserve: reserve.id }, transfers: { 'sample-posted': posted.id, 'sample-held': held.id } });
  }
  return { ...SAMPLE, epoch, expiresAt: nextReset(), pools };
}
