import { SAMPLE } from '../sample.ts';
import { WRITE_ANNOTATIONS, WRITE_TOOL } from './policy.ts';
import type { Hold } from './holds.ts';
export function holdEvent(h: Hold, type: string, now=Date.now(), details: {upstreamStatus?:number|null;latencyMs?:number|null}={}) {
  return { ...SAMPLE, eventId:crypto.randomUUID(), occurredAt:new Date(now).toISOString(), type,
    sequence:JSON.parse(h.journal_json).length+1, visitorId:h.visitor_id, epoch:h.epoch, tool:WRITE_TOOL,
    annotations:WRITE_ANNOTATIONS, requestKey:h.request_key, argumentHash:h.body_hash, arguments:JSON.parse(h.arguments_json),
    policyVersion:h.policy_version, policyRule:h.policy_rule, policyEffect:'REQUIRE_APPROVAL', holdId:h.id, holdState:h.status,
    approver:h.approver, approvedAt:h.approved_at ? new Date(h.approved_at).toISOString():null,
    attemptId:h.attempt_id, replayId:h.replay_count ? h.attempt_id:null, replayCount:h.replay_count,
    upstreamStatus:details.upstreamStatus??null, errorCode:h.error_code, latencyMs:details.latencyMs??null, tellerTransferId:h.teller_id };
}
export async function auditNoop(db:D1Database,h:Hold,code:string) {
  const event={...holdEvent(h,code),sequence:null};
  await db.prepare('INSERT INTO audit_events(id,occurred_at,visitor_id,epoch,tool,code,event_json) VALUES(?,?,?,?,?,?,?)')
    .bind(event.eventId,Date.now(),h.visitor_id,h.epoch,WRITE_TOOL,code,JSON.stringify(event)).run();
}
