import { z } from 'zod';
import { hash, config, validSession, type SessionProps, type Visitor, type Registry } from '../state.ts';
import { SAMPLE, ACCOUNTS } from '../sample.ts';
import { evaluate, WRITE_TOOL } from './policy.ts';
import { holdEvent, auditNoop } from './events.ts';
export const transferInput=z.strictObject({fromAccount:z.enum(ACCOUNTS),toAccount:z.enum(ACCOUNTS),amountMinor:z.number().int().min(1).max(10000),currency:z.literal('CAD'),requestKey:z.uuid()}).refine(v=>v.fromAccount!==v.toAccount);
export interface Hold {
  id:string;visitor_id:string;epoch:string;request_key:string;reference:string;pool_id:string;arguments_json:string;body_json:string;body_hash:string;teller_key:string;
  policy_version:string;policy_rule:string;created_at:number;expires_at:number;status:string;version:number;journal_json:string;
  csrf_hash:string|null;csrf_expires_at:number|null;approver:string|null;approved_at:number|null;attempt_id:string|null;dispatch_at:number|null;replay_count:number;
  send_started_at:number|null;teller_id:string|null;result_json:string|null;error_code:string|null;
}
export function executionCapacity(h:Hold){if(new TextEncoder().encode(h.journal_json).length>224*1024)throw new Error('INSPECTION_ONLY');}
export const ACTIVE_GUARD=`EXISTS(SELECT 1 FROM config c JOIN visitors v ON v.epoch=c.epoch
 WHERE c.id=1 AND c.epoch=holds.epoch AND c.enabled=1 AND c.maintenance=0 AND c.expires_at>?
 AND json_extract(c.tools_json,'$.request_sample_transfer')=1 AND v.id=holds.visitor_id AND v.revoked=0 AND v.expires_at>?)`;
export async function getHold(db:D1Database,visitor:Pick<Visitor,'id'|'epoch'>,id:string):Promise<Hold|null> {
  return db.prepare('SELECT * FROM holds WHERE id=? AND visitor_id=? AND epoch=?').bind(id,visitor.id,visitor.epoch).first<Hold>();
}
// Every state update and its event append share this single compare-and-swap row mutation.
export async function mutate(db:D1Database,old:Hold,changes:Partial<Hold>,type:string,now=Date.now(),guard='',bindings:unknown[]=[],details:{upstreamStatus?:number|null;latencyMs?:number|null}={}):Promise<Hold|null> {
  const allowed=['send_started_at','status','csrf_hash','csrf_expires_at','approver','approved_at','attempt_id','dispatch_at','replay_count','teller_id','result_json','error_code'];
  if(Object.keys(changes).some(k=>!allowed.includes(k))) throw new Error('IMMUTABLE_REQUEST');
  const next={...old,...changes,version:old.version+1};
  const event=holdEvent(next,type,now,details);
  if(new TextEncoder().encode(JSON.stringify(event)).length>4096)throw new Error('EVENT_LIMIT');
  const events=JSON.parse(old.journal_json);events.push(event);
  const journal=JSON.stringify(events);
  if(new TextEncoder().encode(journal).length>262144) throw new Error('JOURNAL_LIMIT');
  const keys=Object.keys(changes) as (keyof Hold)[];
  return db.prepare(`UPDATE holds SET ${keys.map(k=>`${k}=?`).join(',')},version=version+1,journal_json=? WHERE id=? AND version=? AND status=? ${guard ? 'AND '+guard:''} RETURNING *`)
    .bind(...keys.map(k=>changes[k]??null),journal,old.id,old.version,old.status,...bindings).first<Hold>();
}
export async function expireHold(db:D1Database,h:Hold,now=Date.now()):Promise<Hold> {
  if(h.status!=='HELD'||h.expires_at>now)return h;
  return await mutate(db,h,{status:'EXPIRED',csrf_hash:null,csrf_expires_at:null,error_code:null},'EXPIRED',now) ?? (await getHold(db,{id:h.visitor_id,epoch:h.epoch},h.id))!;
}
export async function sweepHolds(db:D1Database,now=Date.now()) {
  const rows=await db.prepare("SELECT * FROM holds WHERE status='HELD' AND expires_at<=? LIMIT 500").bind(now).all<Hold>();
  for(const h of rows.results) await expireHold(db,h,now);
}
export async function createHold(db:D1Database,props:SessionProps,input:unknown):Promise<Hold> {
  const parsed=transferInput.safeParse(input);if(!parsed.success)throw new Error('INVALID_INPUT');
  if(!await validSession(db,props))throw new Error('SESSION_EXPIRED');
  const c=await config(db),registry=await db.prepare('SELECT * FROM sample_registry WHERE visitor_id=? AND epoch=?').bind(props.visitorId,props.epoch).first<Registry>();
  if(!registry)throw new Error('INVALID_INPUT');
  const args=parsed.data,slot=JSON.parse(registry.request_slots_json).find((s:any)=>s.requestKey===args.requestKey);
  if(!slot)throw new Error('INVALID_INPUT');
  const policy=evaluate(WRITE_TOOL,JSON.parse(c.tools_json)[WRITE_TOOL]===true,true,c.epoch===props.epoch);
  if(policy.effect!=='REQUIRE_APPROVAL')throw new Error('DEMO_UNAVAILABLE');
  const accounts=z.strictObject({operating:z.uuid(),reserve:z.uuid()}).parse(JSON.parse(registry.accounts_json));
  const body=JSON.stringify({fromAccountId:accounts[args.fromAccount],toAccountId:accounts[args.toAccount],amountMinor:args.amountMinor,currency:args.currency,initiatedBy:`sample:${props.visitorId}`});
  const bodyHash=await hash(body),now=Date.now();
  const h:Hold={id:crypto.randomUUID(),visitor_id:props.visitorId,epoch:props.epoch,request_key:args.requestKey,reference:slot.reference,pool_id:registry.pool_id,arguments_json:JSON.stringify(args),body_json:body,body_hash:bodyHash,teller_key:`demo:${props.epoch}:${props.visitorId}:${args.requestKey}`,policy_version:policy.version,policy_rule:policy.rule,created_at:now,expires_at:Math.min(now+1800000,c.expires_at),status:'HELD',version:0,journal_json:'[]',csrf_hash:null,csrf_expires_at:null,approver:null,approved_at:null,attempt_id:null,dispatch_at:null,replay_count:0,send_started_at:null,teller_id:null,result_json:null,error_code:null};
  h.journal_json=JSON.stringify([holdEvent(h,'HELD',now)]);
  const keys=Object.keys(h) as (keyof Hold)[];
  await db.prepare(`INSERT INTO holds(${keys.join(',')}) SELECT ${keys.map(()=>'?').join(',')} WHERE EXISTS(SELECT 1 FROM config WHERE id=1 AND epoch=? AND enabled=1 AND maintenance=0 AND expires_at>? AND json_extract(tools_json,'$.request_sample_transfer')=1) AND EXISTS(SELECT 1 FROM visitors WHERE id=? AND epoch=? AND revoked=0 AND expires_at>?) ON CONFLICT(visitor_id,epoch,request_key) DO NOTHING`)
    .bind(...keys.map(k=>h[k]),props.epoch,now,props.visitorId,props.epoch,now).run();
  const existing=await db.prepare('SELECT * FROM holds WHERE visitor_id=? AND epoch=? AND request_key=?').bind(props.visitorId,props.epoch,args.requestKey).first<Hold>();
  if(!existing)throw new Error('HOLD_UNCONFIRMED');
  if(existing.body_hash!==bodyHash||existing.body_json!==body)throw new Error('KEY_CONFLICT');
  if(existing.id!==h.id){try{await auditNoop(db,existing,'DUPLICATE_REQUEST');}catch{throw new Error('DEMO_UNAVAILABLE');}}
  return expireHold(db,existing);
}
export function heldResult(h:Hold,origin:string) {
  return { ...SAMPLE,status:h.status,holdId:h.id,reference:h.reference,requestKey:h.request_key,expiresAt:new Date(h.expires_at).toISOString(),approvalUrl:`${origin}/queue/${h.id}` };
}
export async function issueCsrf(db:D1Database,h:Hold):Promise<string> {
  const token=crypto.randomUUID()+crypto.randomUUID();
  await db.prepare('UPDATE holds SET csrf_hash=?,csrf_expires_at=? WHERE id=? AND visitor_id=? AND version=?').bind(await hash(token),Math.min(Date.now()+600000,h.expires_at),h.id,h.visitor_id,h.version).run();
  return token;
}
export async function decideHold(db:D1Database,visitor:Visitor,id:string,token:string,bodyHash:string,action:'approve'|'deny',health:()=>Promise<boolean>) {
  let h=await getHold(db,visitor,id);if(!h)throw new Error('NOT_FOUND');
  h=await expireHold(db,h);
  let now=Date.now();const csrf=await hash(token);
  if(h.status!=='HELD'||h.csrf_hash!==csrf||!h.csrf_expires_at||h.csrf_expires_at<=now)throw new Error('STALE_ACTION');
  if(h.body_hash!==bodyHash||await hash(h.body_json)!==bodyHash)throw new Error('PAYLOAD_MISMATCH');
  if(action==='approve')executionCapacity(h);
  const healthy=action==='deny'||await health().catch(()=>false);
  now=Date.now();
  if(!healthy){
    const held=await db.prepare(`UPDATE holds SET csrf_hash=NULL,csrf_expires_at=NULL,error_code='HELD_UNAVAILABLE' WHERE id=? AND version=? AND status='HELD' AND csrf_hash=? AND expires_at>? AND ${ACTIVE_GUARD} RETURNING *`).bind(h.id,h.version,csrf,now,now,now).first<Hold>();
    if(!held)throw new Error('STALE_ACTION');
    await auditNoop(db,held,'HELD_UNAVAILABLE');
    return {hold:held,claimed:false};
  }
  const status=action==='deny'?'DENIED':healthy?'DISPATCHING':'HELD';
  const next=await mutate(db,h,{status,send_started_at:null,csrf_hash:null,csrf_expires_at:null,approver:status==='DISPATCHING'?visitor.id:null,approved_at:status==='DISPATCHING'?now:null,attempt_id:status==='DISPATCHING'?crypto.randomUUID():null,dispatch_at:status==='DISPATCHING'?now:null,error_code:healthy?null:'HELD_UNAVAILABLE'},healthy?(action==='deny'?'DENIED':'APPROVED'):'HELD_UNAVAILABLE',now,
    `csrf_hash=? AND csrf_expires_at>? AND expires_at>? AND ${ACTIVE_GUARD} AND (?!='DISPATCHING' OR NOT EXISTS(SELECT 1 FROM holds other WHERE other.visitor_id=holds.visitor_id AND other.epoch=holds.epoch AND other.status IN ('DISPATCHING','OUTCOME_UNKNOWN')))`,[csrf,now,now,now,now,status]);
  if(!next)throw new Error('STALE_ACTION');
  return {hold:next,claimed:status==='DISPATCHING'};
}
export async function retireBrowserSession(db:D1Database,visitor:Visitor) {
  await db.prepare('UPDATE visitors SET revoked=1 WHERE id=? AND epoch=?').bind(visitor.id,visitor.epoch).run();
  const holds=await db.prepare("SELECT * FROM holds WHERE visitor_id=? AND epoch=? AND status='HELD'").bind(visitor.id,visitor.epoch).all<Hold>();
  for(const h of holds.results)await mutate(db,h,{status:'EXPIRED',csrf_hash:null,csrf_expires_at:null},'SESSION_REPLACED');
}
