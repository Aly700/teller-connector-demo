import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { signRequest } from '../packages/signing.ts';
import type { Pool } from '../packages/sample.ts';
test('all 100 real Teller pairs have expected balances and the second-layer hold through signed origin', async () => {
  const pool: Pool = JSON.parse(await readFile('.data/pool.json', 'utf8'));
  assert.equal(pool.pools.length, 100);
  const ids = new Set(pool.pools.flatMap(p => [...Object.values(p.accounts), ...Object.values(p.transfers)]));
  assert.equal(ids.size, 400);
  for (const entry of pool.pools) {
    for (const [path, check] of [
      ['accounts/operating', (v: any) => { assert.equal(v.ledgerBalanceMinor, 99900); assert.equal(v.availableBalanceMinor, 89899); }],
      ['accounts/reserve', (v: any) => { assert.equal(v.ledgerBalanceMinor, 100100); assert.equal(v.availableBalanceMinor, 100100); }],
      ['transfers/sample-posted', (v: any) => assert.equal(v.state, 'POSTED')],
      ['transfers/sample-held', (v: any) => assert.equal(v.state, 'HELD')],
    ] as const) {
      const request = await signRequest(`http://127.0.0.1:18081/v1/pools/${entry.poolId}/${path}`, process.env.ORIGIN_SIGNING_SECRET!, pool.epoch);
      const response = await fetch(request); assert.equal(response.status, 200); check(await response.json());
    }
  }
  console.log('Verified 400 signed origin reads against real Teller. Sample data. No real money.');
});
