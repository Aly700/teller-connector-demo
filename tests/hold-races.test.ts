import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './d1.ts';
import { createHold, getHold, issueCsrf, decideHold, sweepHolds } from '../packages/gate/holds.ts';
import { evaluate } from '../packages/gate/policy.ts';
test('ordered policy takes the first matching rule and defaults to deny', () => {
  assert.equal(evaluate('request_sample_transfer', false, false, true).rule, 'disabled-or-expired');
  assert.equal(evaluate('request_sample_transfer', true, false, true).rule, 'disallowed-input');
  assert.equal(evaluate('request_sample_transfer', true, true, true).effect, 'REQUIRE_APPROVAL');
  assert.equal(evaluate('get_sample_account', true, true, true).effect, 'ALLOW');
  assert.equal(evaluate('approve', true, true, true).effect, 'DENY');
});
test('a held request freezes the body and key, deduplicates, and never calls the network', async () => {
  const f = await fixture(); let calls=0; const original=globalThis.fetch;
  globalThis.fetch=async()=>{calls++;throw new Error('Unexpected network');};
  try {
    const a=await createHold(f.db,f.props,f.input), b=await createHold(f.db,f.props,{...f.input});
    assert.equal(a.id,b.id); assert.equal(a.status,'HELD'); assert.equal(a.expires_at-a.created_at,1800000); assert.equal(calls,0);
    assert.equal(a.teller_key,`demo:${f.props.epoch}:${f.props.visitorId}:${f.input.requestKey}`);
    assert.equal(JSON.parse(a.body_json).initiatedBy,`sample:${f.visitor.id}`);
    await assert.rejects(createHold(f.db,f.props,{...f.input,amountMinor:101}), /KEY_CONFLICT/);
    assert.throws(()=>f.raw.prepare('UPDATE holds SET body_json=? WHERE id=?').run('{}',a.id),/immutable/);
    assert.equal(JSON.parse(a.journal_json).length,1);
  } finally { globalThis.fetch=original; }
});
test('schema, ownership, epoch and kill switch fail closed before a hold', async()=>{
  const f=await fixture();
  for(const input of [{...f.input,approved:true},{...f.input,amountMinor:10001},{...f.input,toAccount:'operating'},{...f.input,requestKey:crypto.randomUUID()}]) await assert.rejects(createHold(f.db,f.props,input),/INVALID_INPUT/);
  await assert.rejects(createHold(f.db,{...f.props,epoch:'old'},f.input));
  f.raw.exec('UPDATE config SET enabled=0'); await assert.rejects(createHold(f.db,f.props,f.input));
  assert.equal(f.raw.prepare('SELECT count(*) n FROM holds').get()!.n,0);
});
test('one-use CSRF and concurrent approve/deny have one atomic state and journal winner',async()=>{
  const f=await fixture(), h=await createHold(f.db,f.props,f.input), token=await issueCsrf(f.db,h);
  const results=await Promise.allSettled(['approve','deny'].map(action=>decideHold(f.db,f.visitor,h.id,token,h.body_hash,action as 'approve'|'deny',async()=>true)));
  const end=await getHold(f.db,f.visitor,h.id); assert.ok(end);
  assert.ok(['DISPATCHING','DENIED'].includes(end.status)); assert.equal(JSON.parse(end.journal_json).length,2);
  assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value.claimed).length,end.status==='DISPATCHING'?1:0);
  await assert.rejects(decideHold(f.db,f.visitor,h.id,token,h.body_hash,'approve',async()=>true),/STALE_ACTION/);
});
test('denial, deadline expiry, stale CSRF and another visitor cannot claim a write',async()=>{
  const f=await fixture(), h=await createHold(f.db,f.props,f.input), stale=await issueCsrf(f.db,h), token=await issueCsrf(f.db,h);
  await assert.rejects(decideHold(f.db,f.visitor,h.id,stale,h.body_hash,'approve',async()=>true),/STALE_ACTION/);
  await assert.rejects(decideHold(f.db,{...f.visitor,id:crypto.randomUUID()},h.id,token,h.body_hash,'approve',async()=>true),/NOT_FOUND/);
  const denied=await decideHold(f.db,f.visitor,h.id,token,h.body_hash,'deny',async()=>true);assert.equal(denied.hold.status,'DENIED');
  const second=await createHold(f.db,f.props,{...f.input,requestKey:f.slots[1].requestKey});
  await sweepHolds(f.db,second.expires_at);
  const expired=await getHold(f.db,f.visitor,second.id);assert.equal(expired!.status,'EXPIRED');
  assert.equal((await createHold(f.db,f.props,{...f.input,requestKey:f.slots[1].requestKey})).status,'EXPIRED');
});
test('known bad health consumes the decision token, stays held and requires fresh approval',async()=>{
  const f=await fixture(),h=await createHold(f.db,f.props,f.input),token=await issueCsrf(f.db,h);
  const result=await decideHold(f.db,f.visitor,h.id,token,h.body_hash,'approve',async()=>false);
  assert.equal(result.hold.status,'HELD');assert.equal(result.claimed,false);
  await assert.rejects(decideHold(f.db,f.visitor,h.id,token,h.body_hash,'approve',async()=>true),/STALE_ACTION/);
});
test('unavailable approvals and duplicate requests do not fill the bounded transition journal',async()=>{
 const f=await fixture();let h=await createHold(f.db,f.props,f.input);
 for(let i=0;i<10;i++){await createHold(f.db,f.props,f.input);h=(await decideHold(f.db,f.visitor,h.id,await issueCsrf(f.db,h),h.body_hash,'approve',async()=>false)).hold;}
 assert.equal(JSON.parse(h.journal_json).length,1);await sweepHolds(f.db,h.expires_at);assert.equal((await getHold(f.db,f.visitor,h.id))!.status,'EXPIRED');
});
test('the approval action checks expiry without a sweep and cannot reach dispatch or upstream health',async()=>{
 const f=await fixture(),h=await createHold(f.db,f.props,f.input),token=await issueCsrf(f.db,h),clock=Date.now;let calls=0;
 try{Date.now=()=>h.expires_at;await assert.rejects(decideHold(f.db,f.visitor,h.id,token,h.body_hash,'approve',async()=>{calls++;return true;}),/STALE_ACTION/);}
 finally{Date.now=clock;}
 assert.equal(calls,0);assert.equal((await getHold(f.db,f.visitor,h.id))!.status,'EXPIRED');
});
