import { browserSession,hash,type SessionProps } from '../../../packages/state.ts';
import { SAMPLE } from '../../../packages/sample.ts';
import { safeHttp, page, escapeHtml as e } from '../../../packages/http.ts';
import { POLICY_VERSION,WRITE_TOOL,WRITE_ANNOTATIONS,evaluate } from '../../../packages/gate/policy.ts';
import type { Hold } from '../../../packages/gate/holds.ts';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { acceptedArguments,tools } from './tools.ts';
import { heading, download, time, eventTitle, badge } from './view.ts';
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

export async function auditPage(request:Request,db:D1Database):Promise<Response> {
 const exportUrl=new URL(request.url);exportUrl.searchParams.delete('view');
 const response=await auditExport(new Request(exportUrl,request),db);
 if(response.status===400)return page('<section class="error-page"><h1>Invalid audit period</h1><p class="intro">Choose a UTC range of up to 49 hours, with the start before the end.</p><div class="buttons"><a class="button secondary" href="/audit">Open the current audit</a></div></section>',400);
 if(!response.ok)return page('<section class="error-page"><h1>Open your sample session</h1><p class="intro">The audit belongs to the browser where you started this connection.</p><div class="buttons"><a class="button secondary" href="/queue">Return to your queue</a></div></section>',response.status);
 const events=(await response.text()).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
 const view=new URL(request.url).searchParams.get('view');
 const filtered=view==='transfers'?events.filter(ev=>ev.holdId):view==='reads'?events.filter(ev=>!ev.holdId):events;
 const shown=filtered.slice(-100).reverse();
 const filterUrl=(key:string)=>{const url=new URL(exportUrl);if(key!=='all')url.searchParams.set('view',key);return '/audit'+url.search;};
 const visitor=await browserSession(db,request);
 const requests=visitor?await db.prepare('SELECT id,reference FROM holds WHERE visitor_id=? AND epoch=?').bind(visitor.id,visitor.epoch).all<{id:string;reference:string}>():{results:[]};
 const references=new Map(requests.results.map(h=>[h.id,h.reference]));
 return page(`${heading('Session audit trail','Inspect the saved decisions, reads, and Teller responses for this session.',download('/audit/export'+exportUrl.search))}<section class="panel"><div class="toolbar"><nav class="audit-filters filters" aria-label="Filter audit events">${[['all','All events'],['transfers','Transfers'],['reads','Reads & access']].map(([key,label])=>`<a class="filter" href="${e(filterUrl(key))}"${(view??'all')===key?' aria-current="page"':''}>${label}</a>`).join('')}</nav><small class="muted">${filtered.length} events · latest first</small></div>${shown.length?`<ol class="audit-list">${shown.map(ev=>{
 const {notice,...details}=ev;
 return `<li>${time(ev.occurredAt)}<div><strong>${e(eventTitle(ev))}</strong><p>${references.has(ev.holdId)?`<a href="/queue/${e(ev.holdId)}">${e(references.get(ev.holdId)!)}</a>`:e(ev.tool??'Browser session')}${ev.policyRule?' · '+e(ev.policyRule):''}</p></div>${ev.holdState?badge(ev.holdState):'<span></span>'}<details><summary>Inspect event fields</summary><pre>${e(JSON.stringify(details,null,2))}</pre></details></li>`;
 }).join('')}</ol>`:`<div class="empty"><h2>${view?'No events in this view':'No recorded activity yet'}</h2><p>Read an account or request a transfer from your connected client to begin this session’s history.</p><a href="/guide">Open the sample guide</a></div>`}<div class="session-note">${filtered.length>100?'Showing the latest 100 events. The export includes the full selected period. ':''}Times are local; hover for UTC. Exported timestamps use UTC. This history is not claimed to be tamper-proof.</div></section>`,200,new Headers(),undefined,'audit');
}
