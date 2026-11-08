import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fixture } from './store.ts';
import type { EvalCase,Runtime } from './run.ts';
import { readTool } from '../apps/mcp/src/tools.ts';
import { TellerClient,accountSchema,transferSchema } from '../apps/mcp/src/teller.ts';
import { SAMPLE,type Pool } from '../packages/sample.ts';
import { createHold,heldResult,decideHold,issueCsrf,expireHold,getHold,type Hold } from '../packages/gate/holds.ts';
import { dispatch,watchdog,type DispatchIO } from '../packages/gate/dispatch.ts';
import { upstreamIO } from '../packages/gate/upstream.ts';
import type { Registry } from '../packages/state.ts';
const emptyLedger=()=>({transfers:0,postings:0,entries:0,net:0});
function ledger(key:string){
 if(!/^demo:[a-f0-9-]+:[a-f0-9-]+:[a-f0-9-]+$/.test(key))throw new Error('INVALID_KEY');
 return JSON.parse(execFileSync((process.env.PG_BIN??'/opt/homebrew/opt/postgresql@16/bin')+'/psql',['-X','-At','-c',`SELECT json_build_object('transfers',count(DISTINCT t.id),'postings',count(DISTINCT e.posting_id),'entries',count(e.id),'net',coalesce(sum(CASE WHEN e.direction='DEBIT' THEN -e.amount_minor ELSE e.amount_minor END),0)) FROM transfers t LEFT JOIN entries e ON e.transfer_id=t.id WHERE t.idempotency_key='${key}'`],{env:{...process.env,PGPASSWORD:process.env.DB_PASSWORD},encoding:'utf8'}));
}
// Faults stay in this operator process. No fault-injection route exists in the public connector.
export function fixtureRuntime(live=false):Runtime {
 let index=0;const pool:Pool|undefined=live?JSON.parse(readFileSync('.data/pool.json','utf8')):undefined;
 return {kind:live?'local-real-teller':'test-fixtures',async run(c:EvalCase){
  const f=await fixture();let posts=0,effects=0;
  try{
   const slots=c.context.requestSlots.map((s:any)=>({...s,used:false}));
   f.raw.prepare('UPDATE sample_registry SET request_slots_json=?').run(JSON.stringify(slots));
   if(pool){const entry=pool.pools[index++];if(!entry||pool.expiresAt-Date.now()<60000)throw new Error('FRESH_ISOLATED_DATASET_REQUIRED');
    f.raw.prepare('UPDATE config SET epoch=?,expires_at=?').run(pool.epoch,pool.expiresAt);f.raw.prepare('UPDATE visitors SET epoch=?,expires_at=?').run(pool.epoch,pool.expiresAt);
    f.raw.prepare('UPDATE sample_registry SET epoch=?,pool_id=?,accounts_json=?,transfers_json=?').run(pool.epoch,entry.poolId,JSON.stringify(entry.accounts),JSON.stringify(entry.transfers));f.props.epoch=pool.epoch as typeof f.props.epoch;f.visitor.epoch=pool.epoch as typeof f.visitor.epoch;
   }
   const registry=await f.db.prepare('SELECT * FROM sample_registry').first<Registry>();assert.ok(registry);
   const accounts=JSON.parse(registry.accounts_json),transfers=JSON.parse(registry.transfers_json),stamp=new Date(f.now).toISOString(),decisionId=crypto.randomUUID(),approvalId=crypto.randomUUID();
   const mockedRead=async(request:Request)=>{
    const path=new URL(request.url).pathname,alias=path.split('/').at(-1)!;
    if(path.includes('/accounts/'))return Response.json({id:accounts[alias],currency:'CAD',status:'ACTIVE',ledgerBalanceMinor:alias==='operating'?99900:100100,availableBalanceMinor:alias==='operating'?89899:100100,version:2,createdAt:stamp});
    return Response.json({id:transfers[alias],fromAccountId:accounts.operating,toAccountId:accounts.reserve,amountMinor:alias==='sample-posted'?100:10001,currency:'CAD',state:alias==='sample-posted'?'POSTED':'HELD',reasonCode:null,decisionId,approvalId:alias==='sample-held'?approvalId:null,createdAt:stamp,postedAt:alias==='sample-posted'?stamp:null,reversedAt:null});
   };
   const client=new TellerClient('http://127.0.0.1:18081',process.env.ORIGIN_SIGNING_SECRET??'fixture-secret'.repeat(4),f.props.epoch,{sleep:async()=>{},fetcher:c.fault?async()=>new Response(null,{status:c.fault!.status}):live?fetch:mockedRead});
   if(c.kind==='refuse'){
    const probe=c.probe!;let code:string;
    if(probe.tool==='request_sample_transfer'){try{await createHold(f.db,f.props,probe.arguments);code='UNEXPECTED_HOLD';}catch(e){code=(e as Error).message;}}
    else {const r=await readTool(probe.tool,probe.arguments,registry,client);code=String(r.structuredContent?.code);}
    assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM holds').get()!.n,0);
    return {decision:'REFUSE',code:(c.expected.selection as {refusal:string}).refusal,probeCode:code,preApprovalPosts:posts};
   }
   const selected=c.expected.selection as {tool:string;arguments:Record<string,unknown>};
   if(c.kind==='read'){
    const captured:Record<string,any>={};
    if(!c.fault){
     if(selected.tool!=='get_sample_transfer')for(const alias of selected.tool==='list_sample_accounts'?['operating','reserve']:[String(selected.arguments.account)])captured[alias]=await client.get(`/v1/pools/${registry.pool_id}/accounts/${alias}`,accountSchema);
     else captured.transfer=await client.get(`/v1/pools/${registry.pool_id}/transfers/${selected.arguments.reference}`,transferSchema);
    }
    const r=await readTool(selected.tool,selected.arguments,registry,client),s=r.structuredContent as any;
    assert.equal(s.sampleData,true);assert.equal(s.notice,SAMPLE.notice);
    if(r.isError)return {decision:'ALLOW',code:s.code,preApprovalPosts:posts};
    if(selected.tool==='list_sample_accounts'){for(const a of s.accounts)for(const k of ['id','createdAt','version'])assert.equal(a[k],captured[a.account][k]);assert.deepEqual(s.requestSlots.map((v:any)=>({reference:v.reference,requestKey:v.requestKey})),c.context.requestSlots);return {decision:'ALLOW',accounts:s.accounts.map((a:any)=>({account:a.account,ledgerBalanceMinor:a.ledgerBalanceMinor,availableBalanceMinor:a.availableBalanceMinor})),slots:s.requestSlots.length,preApprovalPosts:posts};}
    if(selected.tool==='get_sample_account'){for(const k of ['id','createdAt','version'])assert.equal(s[k],captured[s.account][k]);return {decision:'ALLOW',account:s.account,ledgerBalanceMinor:s.ledgerBalanceMinor,availableBalanceMinor:s.availableBalanceMinor,preApprovalPosts:posts};}
    for(const k of ['id','createdAt','postedAt','reversedAt','approvalId','decisionId'])assert.equal(s[k],captured.transfer[k]);
    return {decision:'ALLOW',reference:s.reference,state:s.state,status:s.status,amountMinor:s.amountMinor,preApprovalPosts:posts};
   }
   const before=Date.now();let h=await createHold(f.db,f.props,selected.arguments);const after=Date.now(),initial=heldResult(h,'https://demo.example.invalid');
   assert.match(h.id,/^[a-f0-9-]{36}$/);assert.equal(initial.holdId,h.id);assert.equal(initial.requestKey,selected.arguments.requestKey);assert.equal(initial.approvalUrl,`https://demo.example.invalid/queue/${h.id}`);
   assert.ok(h.created_at>=before&&h.created_at<=after);assert.equal(initial.expiresAt,new Date(h.expires_at).toISOString());assert.equal(h.expires_at,Math.min(h.created_at+1800000,pool?.expiresAt??f.now+3600000));
   const preApprovalPosts=posts;assert.deepEqual(live?ledger(h.teller_key):emptyLedger(),emptyLedger());
   let stored:any=null;const fake:DispatchIO={post:async hold=>{effects=1;const body=JSON.parse(hold.body_json);delete body.initiatedBy;stored??={id:crypto.randomUUID(),...body,state:'POSTED',reasonCode:null,decisionId:null,approvalId:null,createdAt:stamp,postedAt:stamp,reversedAt:null};return {status:201,data:stored};},get:async()=>stored};
   const base=live?upstreamIO('http://127.0.0.1:18081',process.env.ORIGIN_SIGNING_SECRET!,h.epoch):fake;
   const io:DispatchIO={get:base.get,post:async hold=>{posts++;if(c.failureMode==='unavailable')throw new Error('UNAVAILABLE');const r=await base.post(hold);if(c.failureMode==='lost-response')throw new Error('LOST_RESPONSE');return r;}};
   if(c.after==='expire')h=await expireHold(f.db,h,h.expires_at);
   else if(c.after==='deny')h=(await decideHold(f.db,f.visitor,h.id,await issueCsrf(f.db,h),h.body_hash,'deny',async()=>true)).hold;
   else{
    if(c.after==='race')assert.equal((await createHold(f.db,f.props,selected.arguments)).id,h.id);
    h=(await decideHold(f.db,f.visitor,h.id,await issueCsrf(f.db,h),h.body_hash,'approve',async()=>true)).hold;
    if(c.after==='race')await Promise.all([dispatch(f.db,h,io),dispatch(f.db,h,io)]);
    else if(c.failureMode==='crash-after-commit'){
     await assert.rejects(dispatch(f.db,h,io,{boundary:async n=>{if(n==='response-received')throw new Error('FIXTURE_CRASH');}}),/FIXTURE_CRASH/);await watchdog(f.db,Date.now()+31000);
    }else await dispatch(f.db,h,io);
    h=(await getHold(f.db,f.visitor,h.id))!;
   }
   return {decision:'REQUIRE_APPROVAL',initialState:initial.status,preApprovalPosts,terminalState:h.status,ledger:live?ledger(h.teller_key):{transfers:effects,postings:effects,entries:effects*2,net:0}};
  }finally{f.raw.close();}
 }};
}
