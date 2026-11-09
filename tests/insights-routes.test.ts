import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './d1.ts';
import { recordCall, auditExport } from '../apps/mcp/src/audit.ts';
import { getSessionInsights } from '../apps/mcp/src/insights-data.ts';
import { balanceHistory, outcomeChart, policyTrace } from '../apps/mcp/src/insights.ts';
import { createHold } from '../packages/gate/holds.ts';
import { detailPage } from '../apps/mcp/src/pages.ts';
import { requestExplanation } from '../apps/mcp/src/request-explanation.ts';
import type { Env } from '../apps/mcp/src/auth.ts';

test('successful account reads persist whitelisted observations in the same session audit export', async () => {
  const f = await fixture();
  try {
    const registry = f.raw.prepare('SELECT accounts_json FROM sample_registry').get()!;
    const id = JSON.parse(String(registry.accounts_json)).operating;
    const account = {id, account:'operating',currency:'CAD',status:'ACTIVE',ledgerBalanceMinor:12500,availableBalanceMinor:12300,version:2,createdAt:new Date(f.now-1000).toISOString(),sampleData:true,label:'Demo data',notice:'Demo data. No real money.',privateField:'NEVER STORE'};
    await recordCall(f.db, f.props, 'get_account', {account:'operating'}, {content:[{type:'text',text:'RAW PRIVATE TEXT'}],structuredContent:account}, Date.now());
    const insights = await getSessionInsights(f.db, f.props);
    assert.deepEqual(insights.accounts[0].observations.map(p => [p.id,p.availableBalanceMinor,p.ledgerBalanceMinor]), [[id,12300,12500]]);
    assert.equal(insights.accounts[1].historyState,'empty');
    const request = new Request('http://localhost:8787/audit/export',{headers:{Cookie:'__Host-sample-session='+f.cookie}});
    const exported = await (await auditExport(request,f.db)).text();
    assert.ok(exported.includes('accountObservations'));
    assert.doesNotMatch(exported,/NEVER STORE|RAW PRIVATE TEXT|privateField/);
    assert.ok(exported.includes(id));
    const rendered = balanceHistory(insights);
    assert.match(rendered,/One recorded read/);
    assert.match(rendered,/Balance history starts with the first saved Teller read/);
    assert.doesNotMatch(rendered,/polyline/);
    assert.match(outcomeChart(insights.requestCounts,'test'),/Your first transfer request/);
  } finally { f.raw.close(); }
});

test('request facets remain readable when the saved execution journal cannot be verified', async () => {
  const f = await fixture();
  try {
    const h = await createHold(f.db,f.props,f.input);
    f.raw.prepare('UPDATE holds SET journal_json=? WHERE id=?').run('[]',h.id);
    for (const tab of ['stream','details','events','raw']) {
      const response = await detailPage(new Request(`http://localhost:8787/queue/${h.id}?tab=${tab}`,{headers:{Cookie:'__Host-sample-session='+f.cookie}}), {DB:f.db,PUBLIC_ORIGIN:'http://localhost:8787'} as Env, h.id);
      assert.equal(response.status,200);
      const html = await response.text();
      assert.match(html,/In plain words/);
      assert.match(html,/History unavailable/);
      assert.doesNotMatch(html,/name="csrf"|value="approve"|value="deny"/);
    }
    assert.match(policyTrace({...h,policy_version:'future-gate'}),/History unavailable/);
  } finally { f.raw.close(); }
});

test('closed requests with missing journals never claim a verified unsent outcome in any facet', async () => {
  const f = await fixture();
  try {
    const h = await createHold(f.db, f.props, f.input);
    for (const status of ['DENIED', 'EXPIRED']) {
      f.raw.prepare('UPDATE holds SET status=?,journal_json=? WHERE id=?').run(status, '[]', h.id);
      assert.equal(requestExplanation({ ...h, status, journal_json: '[]' }).receipt, 'uncertain');
      for (const tab of ['stream', 'details', 'events', 'raw']) {
        const response = await detailPage(
          new Request(`http://localhost:8787/queue/${h.id}?tab=${tab}`, { headers: { Cookie: '__Host-sample-session=' + f.cookie } }),
          { DB: f.db, PUBLIC_ORIGIN: 'http://localhost:8787' } as Env,
          h.id,
        );
        assert.equal(response.status, 200, `${status} ${tab}`);
        const html = await response.text();
        assert.match(html, /History unavailable/, `${status} ${tab}`);
        assert.match(html, /Teller receipt is not confirmed/, `${status} ${tab}`);
        assert.doesNotMatch(html, /Nothing was sent|No transfer was sent|Teller has received nothing/i, `${status} ${tab}`);
        assert.doesNotMatch(html, /name="csrf"|value="approve"|value="deny"/, `${status} ${tab}`);
      }
    }
  } finally { f.raw.close(); }
});
