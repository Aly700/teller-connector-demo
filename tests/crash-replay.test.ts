import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './d1.ts';
import { createHold,decideHold,issueCsrf,getHold,type Hold } from '../packages/gate/holds.ts';
import { dispatch,watchdog,type DispatchIO } from '../packages/gate/dispatch.ts';
import { claimReplay,inspectReplay } from '../packages/gate/replay.ts';
async function approved(){const f=await fixture(),h=await createHold(f.db,f.props,f.input);return {...f,h:(await decideHold(f.db,f.visitor,h.id,await issueCsrf(f.db,h),h.body_hash,'approve',async()=>true)).hold};}
function upstream(h:Hold){let posts=0,effects=0;const body=JSON.parse(h.body_json),result={id:crypto.randomUUID(),...body,state:'POSTED',reasonCode:null,decisionId:null,approvalId:null,createdAt:new Date().toISOString(),postedAt:new Date().toISOString(),reversedAt:null};delete result.initiatedBy;
const io:DispatchIO={post:async hold=>{assert.equal(hold.body_json,h.body_json);assert.equal(hold.teller_key,h.teller_key);posts++;effects=1;return {status:201,data:result};},get:async()=>result};return {io,counts:()=>({posts,effects})};}
test('claim permits a single dispatch; all recovery uses the immutable request and never an automatic POST',async()=>{
  const f=await approved(),u=upstream(f.h);
  await Promise.all([dispatch(f.db,f.h,u.io),dispatch(f.db,f.h,u.io)]);
  assert.deepEqual(u.counts(),{posts:1,effects:1});const h=(await getHold(f.db,f.visitor,f.h.id))!;
  assert.equal(h.status,'POSTED');assert.equal((await inspectReplay(h)).status,'POSTED');
});
test('each simulated dispatch crash remains uncertain, then explicit same-key recovery has one effect',async()=>{
  for(const boundary of ['claimed','send-recorded','before-send','response-received','response-saved','before-result','result-saved']){
    const f=await approved(),u=upstream(f.h);
    await assert.rejects(dispatch(f.db,f.h,u.io,{boundary:async name=>{if(name===boundary)throw new Error('CRASH');}}),/CRASH/);
    await watchdog(f.db,Date.now()+31000);
    let h=(await getHold(f.db,f.visitor,f.h.id))!;
    assert.ok(['OUTCOME_UNKNOWN','POSTED'].includes(h.status));
    const before=u.counts();await inspectReplay(h);assert.deepEqual(u.counts(),before);
    if(h.status==='OUTCOME_UNKNOWN'){
      h=await claimReplay(f.db,f.visitor,h.id,await issueCsrf(f.db,h),h.body_hash,true);
      await dispatch(f.db,h,u.io);
    }
    h=(await getHold(f.db,f.visitor,f.h.id))!;assert.equal(h.status,'POSTED');assert.equal(u.counts().effects,1);
    assert.equal(h.teller_key,f.h.teller_key);assert.equal(h.body_json,f.h.body_json);
  }
});
test('write failures never retry unattended, malformed success is unknown, explicit replays are capped',async()=>{
  for(const status of [400,401,403,404,409,429,500,503,418]){
    const f=await approved();let posts=0;
    await dispatch(f.db,f.h,{post:async()=>{posts++;return {status,data:null};},get:async()=>{throw new Error('unavailable');}});
    assert.equal(posts,1);const h=(await getHold(f.db,f.visitor,f.h.id))!;
    assert.equal(h.status,[400,401,403,404,409].includes(status)?'UPSTREAM_REJECTED':'OUTCOME_UNKNOWN');
  }
  const f=await approved();const io:DispatchIO={post:async()=>({status:201,data:{secret:'invalid'}}),get:async()=>{throw new Error('unavailable');}};
  await dispatch(f.db,f.h,io);
  for(let i=0;i<3;i++){const h=(await getHold(f.db,f.visitor,f.h.id))!;await dispatch(f.db,await claimReplay(f.db,f.visitor,h.id,await issueCsrf(f.db,h),h.body_hash,true),io);}
  const h=(await getHold(f.db,f.visitor,f.h.id))!;assert.equal(h.status,'OUTCOME_UNKNOWN');
  await assert.rejects(claimReplay(f.db,f.visitor,h.id,await issueCsrf(f.db,h),h.body_hash,true),/INSPECTION_ONLY/);
});
test('kill switch before sending returns to held and needs new approval; expired recovery cannot send',async()=>{
  const f=await approved(),u=upstream(f.h);f.raw.exec("UPDATE config SET tools_json='{}'");
  await dispatch(f.db,f.h,u.io);assert.equal(u.counts().posts,0);assert.equal((await getHold(f.db,f.visitor,f.h.id))!.status,'HELD');
  const other=await approved();await watchdog(other.db,Date.now()+31000);let h=(await getHold(other.db,other.visitor,other.h.id))!;
  other.raw.exec('UPDATE config SET expires_at=0');await assert.rejects(claimReplay(other.db,other.visitor,h.id,await issueCsrf(other.db,h),h.body_hash,true));
});
test('durable-store loss after a real send preserves possible execution; recovery never invents a key',async()=>{
 const f=await approved(),u=upstream(f.h);let lost=false;
 const db={prepare:(query:string)=>{if(lost)throw new Error('store down');return f.db.prepare(query);}} as D1Database;
 const result=await dispatch(db,f.h,{...u.io,post:async h=>{const r=await u.io.post(h);lost=true;return r;}});
 assert.equal(result.status,'OUTCOME_UNKNOWN');assert.equal((await getHold(f.db,f.visitor,f.h.id))!.status,'DISPATCHING');
 lost=false;await watchdog(f.db,Date.now()+31000);const unknown=(await getHold(f.db,f.visitor,f.h.id))!;
 await dispatch(f.db,await claimReplay(f.db,f.visitor,unknown.id,await issueCsrf(f.db,unknown),unknown.body_hash,true),u.io);
 assert.equal(u.counts().effects,1);assert.equal((await getHold(f.db,f.visitor,f.h.id))!.status,'POSTED');
});
test('a stopped send can be approved again with fresh browser authority',async()=>{
 const f=await approved(),u=upstream(f.h);
 await dispatch(f.db,f.h,u.io,{boundary:async name=>{if(name==='send-recorded')f.raw.exec('UPDATE config SET enabled=0');}});
 let h=(await getHold(f.db,f.visitor,f.h.id))!;assert.equal(h.status,'HELD');assert.equal(u.counts().posts,0);
 f.raw.exec('UPDATE config SET enabled=1');h=(await decideHold(f.db,f.visitor,h.id,await issueCsrf(f.db,h),h.body_hash,'approve',async()=>true)).hold;
 await dispatch(f.db,h,u.io);assert.equal(u.counts().effects,1);
});
test('a possibly running unknown request blocks approval of another hold for the same visitor',async()=>{
 const f=await approved();await watchdog(f.db,Date.now()+31000);
 const other=await createHold(f.db,f.props,{...f.input,requestKey:f.slots[1].requestKey});
 await assert.rejects(decideHold(f.db,f.visitor,other.id,await issueCsrf(f.db,other),other.body_hash,'approve',async()=>true),/STALE_ACTION/);
});
test('stopping a replay before send never relabels an earlier possible effect as an unexecuted hold',async()=>{
 for(const where of ['claim','send-recorded']){
  const f=await approved(),u=upstream(f.h);
  await assert.rejects(dispatch(f.db,f.h,u.io,{boundary:async name=>{if(name==='response-received')throw new Error('CRASH');}}));
  await watchdog(f.db,Date.now()+31000);let h=(await getHold(f.db,f.visitor,f.h.id))!;
  h=await claimReplay(f.db,f.visitor,h.id,await issueCsrf(f.db,h),h.body_hash,true);
  if(where==='claim')f.raw.exec('UPDATE config SET enabled=0');
  await dispatch(f.db,h,u.io,{boundary:async name=>{if(name===where)f.raw.exec('UPDATE config SET enabled=0');}});
  h=(await getHold(f.db,f.visitor,h.id))!;assert.equal(h.status,'OUTCOME_UNKNOWN');assert.equal(h.approver,f.visitor.id);assert.equal(u.counts().effects,1);
 }
});
test('repeated provably stopped sends retain room for expiry and cannot exhaust the journal during dispatch',async()=>{
 const f=await fixture();let h=await createHold(f.db,f.props,f.input);let stopped=0;
 for(let i=0;i<250;i++){
  try{h=(await decideHold(f.db,f.visitor,h.id,await issueCsrf(f.db,h),h.body_hash,'approve',async()=>true)).hold;}
  catch(error){assert.match(String(error),/INSPECTION_ONLY/);break;}
  await dispatch(f.db,h,{post:async()=>{assert.fail('No send');},get:async()=>null},{boundary:async name=>{if(name==='send-recorded')f.raw.exec('UPDATE config SET enabled=0');}});
  f.raw.exec('UPDATE config SET enabled=1');h=(await getHold(f.db,f.visitor,h.id))!;stopped++;
 }
 assert.ok(stopped>10&&stopped<250);assert.equal(h.status,'HELD');
 const {sweepHolds}=await import('../packages/gate/holds.ts');await sweepHolds(f.db,h.expires_at);h=(await getHold(f.db,f.visitor,h.id))!;
 assert.equal(h.status,'EXPIRED');assert.ok(Buffer.byteLength(h.journal_json)<262144);
});
test('a duplicate audit failure never reports that an earlier posted request was unsent',async()=>{
 const f=await approved(),u=upstream(f.h);await dispatch(f.db,f.h,u.io);
 const db={prepare:(query:string)=>{if(query.includes('INSERT INTO audit_events'))throw new Error('store down');return f.db.prepare(query);}} as D1Database;
 await assert.rejects(createHold(db,f.props,f.input),/DEMO_UNAVAILABLE/);assert.equal(u.counts().effects,1);
});
test('a rejected recovery POST preserves uncertainty about the earlier accepted attempt',async()=>{
 for(const status of [400,401,403,404,409]){
  const f=await approved(),u=upstream(f.h);await assert.rejects(dispatch(f.db,f.h,u.io,{boundary:async name=>{if(name==='response-received')throw new Error('CRASH');}}));
  await watchdog(f.db,Date.now()+31000);let h=(await getHold(f.db,f.visitor,f.h.id))!;
  h=await claimReplay(f.db,f.visitor,h.id,await issueCsrf(f.db,h),h.body_hash,true);await dispatch(f.db,h,{...u.io,post:async()=>({status,data:null})});
  h=(await getHold(f.db,f.visitor,h.id))!;assert.equal(h.status,'OUTCOME_UNKNOWN');assert.equal(u.counts().effects,1);
  await dispatch(f.db,await claimReplay(f.db,f.visitor,h.id,await issueCsrf(f.db,h),h.body_hash,true),u.io);assert.equal((await getHold(f.db,f.visitor,h.id))!.status,'POSTED');
 }
});
