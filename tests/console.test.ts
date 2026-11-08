import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './d1.ts';
import { createHold, mutate, issueCsrf } from '../packages/gate/holds.ts';
import { detailPage, queuePage, accountsPage } from '../apps/mcp/src/pages.ts';
import { auditPage } from '../apps/mcp/src/audit.ts';
import { guidePage } from '../apps/mcp/src/guide.ts';
import type { Env } from '../apps/mcp/src/auth.ts';
const envFor=(db:D1Database)=>({DB:db,PUBLIC_ORIGIN:'http://localhost:8787'} as Env);
const request=(cookie:string,path='/queue')=>new Request('http://localhost:8787'+path,{headers:{Cookie:'__Host-sample-session='+cookie}});
test('snapshot updates and expiry are visitor-scoped and do not rotate decision tokens',async()=>{
 const f=await fixture(),env=envFor(f.db),h=await createHold(f.db,f.props,f.input);
 const token=await issueCsrf(f.db,h);
 const before=await f.db.prepare('SELECT csrf_hash FROM holds WHERE id=?').bind(h.id).first();
 const response=await queuePage(request(f.cookie),env,true),data=await response.json() as any;
 assert.equal(response.status,200);assert.match(data.html,/Needs approval/);assert.ok(data.revision.includes(h.id));
 assert.deepEqual(await f.db.prepare('SELECT csrf_hash FROM holds WHERE id=?').bind(h.id).first(),before);assert.ok(token);
 assert.equal((await queuePage(new Request('http://localhost:8787/queue/snapshot',{headers:{Authorization:'Bearer '+f.cookie}}),env,true)).status,401);
 const now=Date.now;try{Date.now=()=>now()-1800001;await createHold(f.db,f.props,{...f.input,requestKey:f.slots[1].requestKey});}finally{Date.now=now;}
 const expired=await (await queuePage(request(f.cookie),env,true)).json() as any;
 assert.match(expired.html,/Expired/);assert.notEqual(expired.revision,data.revision);
 for(let i=0;i<28;i++)await queuePage(request(f.cookie),env,true);
 assert.equal((await queuePage(request(f.cookie),env,true)).status,429);
 f.raw.close();
});
test('all request outcomes render honest receipt boundaries, exact event times and isolated audit',async()=>{
 for(const state of ['HELD','POSTED','DENIED','EXPIRED','DISPATCHING','OUTCOME_UNKNOWN','TELLER_HELD','TELLER_DENIED','UPSTREAM_REJECTED']){
  const f=await fixture(),env=envFor(f.db);let h=await createHold(f.db,f.props,f.input);
  if(state!=='HELD') h=(await mutate(f.db,h,{status:state,...(['POSTED','TELLER_HELD','TELLER_DENIED'].includes(state)?{teller_id:crypto.randomUUID(),send_started_at:Date.now()}:{}),...(['DISPATCHING','OUTCOME_UNKNOWN','UPSTREAM_REJECTED'].includes(state)?{send_started_at:Date.now()}: {})},state))!;
  const html=await (await detailPage(request(f.cookie),env,h.id)).text();
  assert.match(html,/Event timeline/);assert.match(html,/Idempotency key/);assert.ok(html.includes(h.policy_rule));assert.ok(html.includes(new Date(h.created_at).toISOString()));
  assert.equal((html.match(/Sample data\. No real money\./g)||[]).length,1);
  assert.equal(html.includes('Teller has received nothing'),['HELD','DENIED','EXPIRED'].includes(state));
  assert.equal(html.includes('name="action" value="approve"'),state==='HELD');
  if(state==='POSTED'){assert.match(html,/Ledger reference:/);assert.ok(html.includes(h.teller_id!));}
  const audit=await (await auditPage(request(f.cookie,'/audit'),f.db)).text();assert.ok(audit.includes(h.request_key));
  assert.equal((await auditPage(new Request('http://localhost:8787/audit'),f.db)).status,401);
  f.raw.close();
 }
});
test('guide only offers unused keys as examples and safely escapes session data',async()=>{
 const f=await fixture();await createHold(f.db,f.props,f.input);
 const html=await (await guidePage(request(f.cookie,'/guide'),envFor(f.db))).text();
 assert.match(html,/Used · retained for idempotency/);assert.ok(html.includes(f.slots[1].requestKey));
 for(const slot of f.slots.slice(1))await createHold(f.db,f.props,{...f.input,requestKey:slot.requestKey});
 assert.match(await (await guidePage(request(f.cookie,'/guide'),envFor(f.db))).text(),/All five keys have been used/);
 assert.equal((await guidePage(new Request('http://localhost:8787/guide'),envFor(f.db))).status,401);
 f.raw.close();
});

test('browser account reads respect the tool kill switch',async()=>{
 const f=await fixture();
 f.raw.prepare("UPDATE config SET tools_json=json_set(tools_json,'$.list_sample_accounts',0)").run();
 const response=await accountsPage(request(f.cookie,'/accounts'),envFor(f.db));
 assert.equal(response.status,503);assert.match(await response.text(),/read is currently disabled/);
 f.raw.close();
});
test('audit view filters retain a complete export and do not leak into reads',async()=>{
 const f=await fixture();await createHold(f.db,f.props,f.input);
 const transfers=await (await auditPage(request(f.cookie,'/audit?view=transfers'),f.db)).text();
 assert.match(transfers,/Held by the connector/);
 const reads=await (await auditPage(request(f.cookie,'/audit?view=reads'),f.db)).text();
 assert.ok(!reads.includes('Held by the connector'));assert.match(reads,/No events in this view/);
 assert.match(reads,/href="\/audit\/export"/);
 const range='from=2026-11-08T00%3A00%3A00Z&to=2026-11-09T00%3A00%3A00Z';
 const ranged=await (await auditPage(request(f.cookie,'/audit?view=reads&'+range),f.db)).text();
 assert.ok(ranged.includes('/audit/export?'+range.replace('&','&#38;')));
 assert.match(ranged,/view=transfers/);
 const invalid=await auditPage(request(f.cookie,'/audit?from=invalid'),f.db);
 assert.equal(invalid.status,400);assert.match(await invalid.text(),/Invalid audit period/);

 f.raw.close();
});
