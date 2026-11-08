import { hash, type Visitor } from '../state.ts';
import { executionCapacity, ACTIVE_GUARD, getHold, mutate, type Hold } from './holds.ts';
import { POLICY_VERSION } from './policy.ts';
// Inspection folds recorded history only. There is no network dependency.
export async function inspectReplay(h:Hold) {
  if(await hash(h.body_json)!==h.body_hash)throw new Error('PAYLOAD_MISMATCH');
  const events=JSON.parse(h.journal_json);
  let status:string|null=null;
  for(const [i,event] of events.entries()){
    if(event.sequence!==i+1||event.holdId!==h.id||event.requestKey!==h.request_key||event.argumentHash!==h.body_hash||event.policyVersion!==h.policy_version)throw new Error('HISTORY_MISMATCH');
    status=event.holdState;
  }
  if(status!==h.status)throw new Error('HISTORY_MISMATCH');
  return {status,bodyHash:h.body_hash,policyVersion:h.policy_version,currentPolicyMatches:h.policy_version===POLICY_VERSION,events};
}
export async function claimReplay(db:D1Database,visitor:Visitor,id:string,token:string,bodyHash:string,confirmed:boolean):Promise<Hold> {
  const h=await getHold(db,visitor,id);if(!h)throw new Error('NOT_FOUND');
  const now=Date.now(),csrf=await hash(token);
  if(!['OUTCOME_UNKNOWN','TELLER_HELD'].includes(h.status)||!h.approver||!h.approved_at||h.expires_at<=now||h.replay_count>=3||!confirmed)throw new Error('INSPECTION_ONLY');
  if(h.csrf_hash!==csrf||!h.csrf_expires_at||h.csrf_expires_at<=now)throw new Error('STALE_ACTION');
  if(h.body_hash!==bodyHash)throw new Error('PAYLOAD_MISMATCH');
  executionCapacity(h);
  await inspectReplay(h);
  const next=await mutate(db,h,{status:'DISPATCHING',csrf_hash:null,csrf_expires_at:null,attempt_id:crypto.randomUUID(),dispatch_at:now,send_started_at:null,replay_count:h.replay_count+1,error_code:null},'REPLAY_APPROVED',now,
    `csrf_hash=? AND expires_at>? AND ${ACTIVE_GUARD} AND NOT EXISTS(SELECT 1 FROM holds other WHERE other.visitor_id=holds.visitor_id AND other.epoch=holds.epoch AND other.id!=holds.id AND other.status IN ('DISPATCHING','OUTCOME_UNKNOWN'))`,[csrf,now,now,now]);
  if(!next)throw new Error('INSPECTION_ONLY');return next;
}
