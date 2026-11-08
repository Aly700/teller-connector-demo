import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signRequest, verifyRequest } from '../packages/signing.ts';
import { originFetch } from '../origin/handler.ts';
import { nextReset } from '../origin/seed.ts';

const secret = 'a'.repeat(64);
const epoch = crypto.randomUUID();
const accountId = crypto.randomUUID();
const pool = { epoch, expiresAt: Date.now() + 3600000, pools: [{ poolId: '001', accounts: { operating: accountId, reserve: crypto.randomUUID() }, transfers: { 'sample-posted': crypto.randomUUID(), 'sample-held': crypto.randomUUID() } }] };
test('signed origin request binds method, path, timestamp and epoch', async () => {
  const request = await signRequest('http://localhost/v1/pools/001/accounts/operating', secret, epoch);
  assert.equal(await verifyRequest(request, secret, epoch), true);
  for (const url of ['http://localhost/v1/pools/001/accounts/reserve', 'http://localhost/v1/admin']) {
    assert.equal(await verifyRequest(new Request(url, { headers: request.headers }), secret, epoch), false);
  }
  assert.equal(await verifyRequest(request, secret, crypto.randomUUID()), false);
  assert.equal(await verifyRequest(request, secret, epoch, Date.now() + 61000), false);
});
test('origin only forwards signed fixed GET routes and refuses maintenance or stale pools', async () => {
  let calls = 0;
  const upstream = async (request: Request) => {
    calls++;
    assert.equal(new URL(request.url).pathname, `/accounts/${accountId}`);
    assert.equal(request.headers.get('X-API-Key'), 'teller-key');
    assert.equal(request.headers.has('authorization'), false);
    return Response.json({ id: accountId });
  };
  const options = { secret, apiKey: 'teller-key', pool, maintenance: false, upstream };
  const url = 'http://localhost/v1/pools/001/accounts/operating';
  assert.equal((await originFetch(new Request(url), options)).status, 403);
  assert.equal((await originFetch(await signRequest(url, secret, epoch), options)).status, 200);
  assert.equal(calls, 1);
  for (const path of ['/approvals/abc/approve', '/transfers', '/v1/pools/001/accounts/evil', '/v1/pools/001/accounts/operating?x=1']) {
    assert.equal((await originFetch(await signRequest('http://localhost' + path, secret, epoch), options)).status, 404);
  }
  assert.equal((await originFetch(await signRequest(url, secret, epoch, 'POST'), options)).status, 404);
  assert.equal((await originFetch(await signRequest(url, secret, epoch), { ...options, maintenance: true })).status, 503);
  assert.equal((await originFetch(await signRequest(url, secret, epoch), { ...options, pool: { ...pool, expiresAt: 1 } })).status, 503);
  assert.equal(calls, 1);
});
test('reset deadline follows 03:00 Toronto across DST changes', () => {
  assert.equal(new Date(nextReset(Date.parse('2026-11-01T04:00:00Z'))).toISOString(), '2026-11-01T08:00:00.000Z');
  assert.equal(new Date(nextReset(Date.parse('2026-03-08T05:00:00Z'))).toISOString(), '2026-03-08T07:00:00.000Z');
});
