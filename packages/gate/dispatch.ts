import { ACTIVE_GUARD, mutate, getHold, type Hold } from './holds.ts';
import { transferSchema } from '../../apps/mcp/src/teller.ts';
import { inspectReplay } from './replay.ts';
export interface DispatchIO {post:(h:Hold)=>Promise<{status:number;data:unknown}>;get:(h:Hold)=>Promise<unknown>}
interface Hooks {boundary?:(name:string)=>Promise<void>}
export async function watchdog(db:D1Database,now=Date.now(),visitor?:{id:string;epoch:string}) {
  const rows=await db.prepare(`SELECT * FROM holds WHERE status='DISPATCHING' AND dispatch_at<=? ${visitor?'AND visitor_id=? AND epoch=?':''} LIMIT 500`).bind(now-30000,...(visitor?[visitor.id,visitor.epoch]:[])).all<Hold>();
  for(const h of rows.results)await mutate(db,h,{status:'OUTCOME_UNKNOWN',csrf_hash:null,error_code:'OUTCOME_UNKNOWN'},'DISPATCH_INTERRUPTED',now);
}
function checked(h:Hold,value:unknown){
  const result=transferSchema.parse(value),body=JSON.parse(h.body_json);
  if(result.fromAccountId!==body.fromAccountId||result.toAccountId!==body.toAccountId||result.amountMinor!==body.amountMinor||result.currency!==body.currency||(h.teller_id&&result.id!==h.teller_id))throw new Error('UPSTREAM_CONTRACT');
  return result;
}
export async function dispatch(db:D1Database,claim:Hold,io:DispatchIO,hooks:Hooks={}):Promise<Hold> {
  let h=claim;
  const boundary=async(name:string)=>hooks.boundary?.(name);
  const current=async()=>await getHold(db,{id:h.visitor_id,epoch:h.epoch},h.id)??h;
  if(h.status!=='DISPATCHING'||!h.approver||!h.approved_at||h.send_started_at)return current();
  const stopped=async()=>{
    // A stopped replay says nothing about whether the earlier attempt executed.
    const changes:Partial<Hold>=h.replay_count>0?{status:'OUTCOME_UNKNOWN',error_code:'OUTCOME_UNKNOWN',csrf_hash:null}:{status:h.expires_at<=Date.now()?'EXPIRED':'HELD',approver:null,approved_at:null,attempt_id:null,dispatch_at:null,send_started_at:null,csrf_hash:null,error_code:'HELD_UNAVAILABLE'};
    return await mutate(db,h,changes,h.replay_count>0?'REPLAY_STOPPED_BEFORE_SEND':'STOPPED_BEFORE_SEND')??await current();
  };
  await boundary('claimed');
  await inspectReplay(h);
  const now=Date.now();
  // A failed pre-send guard proves this invocation has not called upstream.
  const claimed=await mutate(db,h,{send_started_at:now},'SEND_CLAIMED',now,`send_started_at IS NULL AND expires_at>? AND ${ACTIVE_GUARD}`,[now,now,now]);
  if(!claimed){
    const latest=await current();
    if(latest.version!==h.version)return latest;
    return stopped();
  }
  h=claimed;await boundary('send-recorded');
  // Recheck immediately before the network call, including a retired visitor and the write switch.
  const allowed=await db.prepare(`SELECT id FROM holds WHERE id=? AND status='DISPATCHING' AND version=? AND expires_at>? AND ${ACTIVE_GUARD}`).bind(h.id,h.version,Date.now(),Date.now(),Date.now()).first();
  if(!allowed)return stopped();
  await boundary('before-send');
  const started=Date.now();let upstreamStatus:number|null=null;
  const unknown=async(type='OUTCOME_UNKNOWN')=>{
    try{return await mutate(db,h,{status:'OUTCOME_UNKNOWN',error_code:'OUTCOME_UNKNOWN'},type,Date.now(),'',[],{upstreamStatus,latencyMs:Date.now()-started})??await current();}
    catch{return {...h,status:'OUTCOME_UNKNOWN',error_code:'OUTCOME_UNKNOWN'};}
  };
  if(!h.teller_id){
    let response:{status:number;data:unknown};
    try{response=await io.post(h);upstreamStatus=response.status;}catch{return unknown();}
    await boundary('response-received');
    if(![200,201].includes(response.status)){
      if(![400,401,403,404,409].includes(response.status))return unknown();
      if(h.replay_count>0)return unknown('REPLAY_REJECTED');
      const code=[401,403].includes(response.status)?'UPSTREAM_AUTH':response.status===409?'UPSTREAM_CONFLICT':'UPSTREAM_REJECTED';
      try{return await mutate(db,h,{status:'UPSTREAM_REJECTED',error_code:code},'UPSTREAM_REJECTED',Date.now(),'',[],{upstreamStatus,latencyMs:Date.now()-started})??await current();}catch{return unknown();}
    }
    try{
      const result=checked(h,response.data);
      const saved=await mutate(db,h,{teller_id:result.id,result_json:JSON.stringify(result)},'RESPONSE_SAVED',Date.now(),'',[],{upstreamStatus,latencyMs:Date.now()-started});
      if(!saved)return current();h=saved;
    }catch{return unknown();}
    await boundary('response-saved');
  }
  let result:ReturnType<typeof checked>;
  // Teller replays its stored POST response. GET the ID for the current state, including recovery.
  try{result=checked(h,await io.get(h));}catch{return unknown();}
  await boundary('before-result');
  const status=result.state==='POSTED'?'POSTED':result.state==='HELD'?'TELLER_HELD':result.state==='DENIED'?'TELLER_DENIED':'OUTCOME_UNKNOWN';
  try{
    const saved=await mutate(db,h,{status,result_json:JSON.stringify(result),error_code:status==='OUTCOME_UNKNOWN'?'OUTCOME_UNKNOWN':null},'RESULT_SAVED',Date.now(),'',[],{upstreamStatus,latencyMs:Date.now()-started});
    if(saved)h=saved;else return current();
  }catch{return unknown();}
  await boundary('result-saved');return h;
}
