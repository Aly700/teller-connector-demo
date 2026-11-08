import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('.data/contracts', { recursive: true });
const base = 'http://127.0.0.1:18080';
const headers = { 'X-API-Key': process.env.TELLER_API_KEY, 'Content-Type': 'application/json' };
async function post(path, body, extra = {}) {
  const response = await fetch(base + path, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  assert.ok(response.ok, `Setup status ${response.status}`);
  return response.json();
}
const a = await post('/accounts', { currency: 'CAD' });
const b = await post('/accounts', { currency: 'CAD' });
await post('/policies', { name: 'Sample data. No real money. Bootstrap default denial', version: 1 });
const t = await post('/transfers', { fromAccountId: a.id, toAccountId: b.id, amountMinor: 1, currency: 'CAD', initiatedBy: 'sample-bootstrap' }, { 'Idempotency-Key': `bootstrap:${crypto.randomUUID()}` });
assert.equal(t.state, 'DENIED');
for (const [name, path] of [['account', `/accounts/${a.id}`], ['transfer', `/transfers/${t.id}`]]) {
  const response = await fetch(base + path, { headers });
  assert.equal(response.status, 200);
  const record = { ...await response.json(), sampleData: true, label: 'Sample data', notice: 'Sample data. No real money.' };
  await writeFile(`.data/contracts/bootstrap-${name}.json`, JSON.stringify(record, null, 2) + '\n');
}
console.log('Captured real Teller account and transfer GET contracts. Sample data. No real money.');
