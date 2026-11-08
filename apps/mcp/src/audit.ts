import { browserSession,hash,type SessionProps } from '../../../packages/state.ts';
import { SAMPLE } from '../../../packages/sample.ts';
import { safeHttp } from '../../../packages/http.ts';
import { POLICY_VERSION,WRITE_TOOL,WRITE_ANNOTATIONS,evaluate } from '../../../packages/gate/policy.ts';
import type { Hold } from '../../../packages/gate/holds.ts';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { acceptedArguments,tools } from './tools.ts';
export function emptyEvent(props:SessionProps|null,type:string){return {...SAMPLE,eventId:crypto.randomUUID() as string,occurredAt:new Date().toISOString(),type,sequence:null,visitorId:props?.visitorId??null,epoch:props?.epoch??null,tool:null as string|null,annotations:null as unknown,requestKey:null as string|null,argumentHash:null as string|null,arguments:null as unknown,policyVersion:null as string|null,policyRule:null as string|null,policyEffect:null as string|null,holdId:null as string|null,holdState:null as string|null,approver:null as string|null,approvedAt:null as string|null,attemptId:null as string|null,replayId:null as string|null,upstreamStatus:null as number|null,errorCode:null as string|null,latencyMs:null as number|null,tellerTransferId:null as string|null};}
export async function saveEvent(db:D1Database,event:ReturnType<typeof emptyEvent>){
 await db.prepare('INSERT INTO audit_events(id,occurred_at,visitor_id,epoch,tool,code,event_json) VALUES(?,?,?,?,?,?,?)').bind(event.eventId,Date.parse(event.occurredAt),event.visitorId,event.epoch,event.tool,event.errorCode??event.type,JSON.stringify(event)).run();
}
export async function recordCall(db:D1Database,props:SessionProps,name:string,args:unknown,result:CallToolResult,started:number,hold?:Hold,enabled=true){
 const tool=tools.find(t=>t.name===name),event=emptyEvent(props,result.isError?'TOOL_REFUSED':'READ_OK');
 const code=result.isError?String(result.structuredContent?.code??'DEMO_UNAVAILABLE'):null;
 const accepted=code==='INVALID_INPUT'||!enabled||!tool?null:acceptedArguments(name,args);
 const policy=evaluate(name,enabled,accepted!==null,true);
 Object.assign(event,{tool:tool?.name??'unknown',annotations:tool?.annotations??null,arguments:accepted,argumentHash:accepted?await hash(JSON.stringify(accepted)):null,policyVersion:policy.version,policyRule:policy.rule,policyEffect:policy.effect,errorCode:code,latencyMs:Date.now()-started,upstreamStatus:typeof result._meta?.upstreamStatus==='number'?result._meta.upstreamStatus:null,tellerTransferId:result.structuredContent?.id??null});
 if(hold)Object.assign(event,{requestKey:hold.request_key,argumentHash:hold.body_hash,holdId:hold.id,holdState:hold.status,approver:hold.approver,approvedAt:hold.approved_at?new Date(hold.approved_at).toISOString():null,attemptId:hold.attempt_id,replayId:hold.replay_count?hold.attempt_id:null,tellerTransferId:hold.teller_id});
 await saveEvent(db,event);
}
export async function securityEvent(db:D1Database,props:SessionProps|null,code:string,hold?:Hold){const event=emptyEvent(props,'BROWSER_REFUSED');event.errorCode=code;if(hold)Object.assign(event,{holdId:hold.id,requestKey:hold.request_key,argumentHash:hold.body_hash,holdState:hold.status,attemptId:hold.attempt_id,replayId:hold.replay_count?hold.attempt_id:null,tellerTransferId:hold.teller_id});event.eventId=await hash(`browser:${props?.visitorId??'none'}:${code}:${hold?.id??'none'}:${Math.floor(Date.now()/60000)}`);await db.prepare('INSERT INTO audit_events(id,occurred_at,visitor_id,epoch,tool,code,event_json) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(event.eventId,Date.parse(event.occurredAt),props?.visitorId??null,props?.epoch??null,event.tool,code,JSON.stringify(event)).run();}
export async function auditExport(request:Request,db:D1Database):Promise<Response>{
 const visitor=await browserSession(db,request);if(!visitor)return safeHttp('SESSION_REQUIRED',401);
 if(request.method!=='GET')return safeHttp('METHOD_NOT_ALLOWED',405);
 const url=new URL(request.url),from=url.searchParams.get('from')??new Date(Date.now()-48*3600000).toISOString(),to=url.searchParams.get('to')??new Date(Date.now()+1).toISOString();
 const utc=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
 if([...url.searchParams.keys()].some(k=>!['from','to'].includes(k))||!utc.test(from)||!utc.test(to)||!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||Date.parse(from)>=Date.parse(to)||Date.parse(to)-Date.parse(from)>49*3600000)return safeHttp('INVALID_RANGE',400);
 const [holds,audit]=await Promise.all([
  db.prepare('SELECT journal_json FROM holds WHERE visitor_id=? AND epoch=?').bind(visitor.id,visitor.epoch).all<Pick<Hold,'journal_json'>>(),
  db.prepare('SELECT * FROM audit_events WHERE visitor_id=? AND epoch=? AND occurred_at>=? AND occurred_at<? ORDER BY occurred_at,id').bind(visitor.id,visitor.epoch,Date.parse(from),Date.parse(to)).all<any>(),
 ]);
 const events=[...holds.results.flatMap(h=>JSON.parse(h.journal_json)),...audit.results.map(row=>row.event_json?JSON.parse(row.event_json):{...emptyEvent({visitorId:visitor.id,epoch:visitor.epoch},row.code),eventId:row.id,occurredAt:new Date(row.occurred_at).toISOString(),tool:row.tool,errorCode:row.code})]
 .filter(ev=>Date.parse(ev.occurredAt)>=Date.parse(from)&&Date.parse(ev.occurredAt)<Date.parse(to));
 events.sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)||(a.holdId&&a.holdId===b.holdId?(a.sequence??0)-(b.sequence??0):a.eventId.localeCompare(b.eventId)));
 let cursor=0;const stream=new ReadableStream({pull(controller){const event=events[cursor++];if(event)controller.enqueue(new TextEncoder().encode(JSON.stringify(event)+'\n'));else controller.close();}});
 return new Response(stream,{headers:{'Content-Type':'application/x-ndjson; charset=utf-8','Content-Disposition':'attachment; filename="sample-audit.jsonl"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
