import { page, escapeHtml as e } from '../../../packages/http.ts';
import { browserSession, type Registry } from '../../../packages/state.ts';
import { expireHold,getHold,issueCsrf,type Hold } from '../../../packages/gate/holds.ts';
import { inspectReplay } from '../../../packages/gate/replay.ts';
import { recordCall } from './audit.ts';
import { holdErrors } from '../../../packages/gate/errors.ts';
import { readTool } from './tools.ts';
import { TellerClient } from './teller.ts';
import type { Env } from './auth.ts';
export const states:Record<string,[string,string]>={
 HELD:['Waiting for your approval','Held by this connector. Teller has received no transfer request. Review the amount and accounts before deciding.'],
 DENIED:['Rejected by you','This request is closed. Nothing was sent to Teller.'],
 EXPIRED:['Approval expired','The approval window has closed. Nothing was sent to Teller. Use a different unused request key for a new transfer.'],
 DISPATCHING:['Result not confirmed yet','Your approval is saved. Teller may be processing this request. Refresh this page to check. Do not create another request.'],
 OUTCOME_UNKNOWN:['Result not confirmed',"Teller may already have processed this transfer. Do not create another request to replace it. Check this approved request using its original key."],
 POSTED:['Posted in Teller',"The sample transfer is recorded in Teller's ledger."],
 TELLER_HELD:['Held by Teller',"Teller is waiting for its own payment-policy approval. This is separate from the connector hold. Connector approval alone does not mean a transfer is posted."],
 TELLER_DENIED:['Denied by Teller','Teller declined the sample transfer under its own policy. It was not posted.'],
 UPSTREAM_REJECTED:['Teller rejected the request','The request reached the upstream boundary and was rejected. It will not retry automatically.'],
};
export const money=(n:number)=>new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'}).format(n/100)+' CAD';
const time=(n:number)=>new Date(n).toISOString().replace('T',' ').replace(/\.\d{3}Z$/,' UTC');
const fact=(label:string,value:string)=>`<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`;
export function pageError(title:string,message:string,status:number){return page(`<h1>${e(title)}</h1><p>${e(message)}</p><a href="/queue">Return to your queue</a>`,status);}
export async function queuePage(request:Request,env:Env):Promise<Response>{
 const visitor=await browserSession(env.DB,request);if(!visitor)return pageError('Open your sample session','Use the browser where you started the connection. A copied link or MCP token cannot open another session.',401);
 const rows=await env.DB.prepare('SELECT * FROM holds WHERE visitor_id=? AND epoch=? ORDER BY created_at DESC,id').bind(visitor.id,visitor.epoch).all<Hold>();
 const holds=await Promise.all(rows.results.map(h=>expireHold(env.DB,h)));
 const items=holds.map(h=>{const a=JSON.parse(h.arguments_json);return `<li><div class="row"><div><h2><a href="/queue/${h.id}">${e(h.reference)}</a></h2><p>${e(a.fromAccount)} to ${e(a.toAccount)}</p><p class="state">${states[h.status][0]}</p></div><span class="amount">${money(a.amountMinor)}</span></div></li>`;}).join('');
 return page(`<p><a href="/session/end">End sample session</a></p><p class="eyebrow">Your temporary session</p><h1>Your sample queue</h1><p class="intro">Review each request before this connector sends it to Teller. Only this browser session can approve or reject it.</p>${holds.length?`<ul class="queue">${items}</ul>`:'<p class="alert">No requests yet. Ask your connected client to request a sample transfer, then open the approval link.</p>'}<h2>Seeded examples</h2><p class="muted">These examples were created when the sample data was prepared.</p><ul class="queue"><li><div class="row"><div><h2><a href="/queue/sample-held">sample-held</a></h2><p class="state">Held by Teller</p></div><span class="amount">${money(10001)}</span></div></li><li><div class="row"><div><h2><a href="/queue/sample-posted">sample-posted</a></h2><p class="state">Posted in Teller</p></div><span class="amount">${money(100)}</span></div></li></ul><p><a href="/audit/export">Download this session's audit (JSON lines)</a></p><p><a href="/eval">Read the connector evaluation</a></p>`);
}
export async function detailPage(request:Request,env:Env,id:string,error?:string,status=200):Promise<Response>{
 const visitor=await browserSession(env.DB,request);if(!visitor)return pageError('Open your sample session','Return to the browser where you started this sample session. An MCP token cannot approve a request.',401);
 let h=await getHold(env.DB,visitor,id);if(!h)return pageError('Request not found','This request is not part of your current sample session.',404);
 h=await expireHold(env.DB,h);const a=JSON.parse(h.arguments_json),[title,description]=states[h.status];
 let controls='';
 if(h.status==='HELD'&&!error){
  const csrf=await issueCsrf(env.DB,h);
  controls=`<section class="actions"><h2>Your decision</h2><p>Approve this exact ${money(a.amountMinor)} transfer from ${e(a.fromAccount)} to ${e(a.toAccount)}. Teller may apply its own policy after your approval.</p><p class="muted">Approval closes at ${time(h.expires_at)}.</p><form method="post" action="/queue/${h.id}"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="bodyHash" value="${h.body_hash}"><div class="buttons"><button name="action" value="approve">Approve sample transfer</button><button class="secondary" name="action" value="deny">Reject request</button></div></form></section>`;
 }else if(!error&&['OUTCOME_UNKNOWN','TELLER_HELD'].includes(h.status)&&h.expires_at>Date.now()&&h.replay_count<3){
  const csrf=await issueCsrf(env.DB,h);
  controls=`<section class="actions"><h2>Check the original request</h2><p>This checks a known transfer first. If the transfer ID was lost, it sends the saved request with the same key. It does not create a new request.</p><form method="post" action="/queue/${h.id}"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="bodyHash" value="${h.body_hash}"><label><input type="checkbox" name="confirmed" value="yes" required><span>I understand the original transfer may already have happened.</span></label><div class="buttons"><button name="action" value="replay">Check/retry this approved request</button></div></form><p class="muted">${3-h.replay_count} checks remain before ${time(h.expires_at)}.</p></section>`;
 }else if(h.status==='DISPATCHING')controls=`<p><a href="/queue/${h.id}">Refresh the result</a></p>`;
 else if(h.status==='OUTCOME_UNKNOWN')controls='<p class="alert">Recovery is closed for this request. Its result remains uncertain. You can inspect and export its history.</p>';
 if(error)controls=`<p><a href="/queue/${h.id}">Open the current request to review it again</a></p>`;
 const history=await inspectReplay(h);
 const eventNames:Record<string,string>={HELD:'Request held for review',APPROVED:'Browser approval saved',DENIED:'Request rejected',EXPIRED:'Approval expired',SEND_CLAIMED:'Dispatch recorded',RESPONSE_SAVED:'Teller response recorded',RESULT_SAVED:'Current Teller result recorded',OUTCOME_UNKNOWN:'Result could not be confirmed',DISPATCH_INTERRUPTED:'Dispatch interrupted',REPLAY_APPROVED:'Browser recovery approved',REPLAY_REJECTED:'Recovery attempt rejected; earlier outcome uncertain',STOPPED_BEFORE_SEND:'Stopped before sending',REPLAY_STOPPED_BEFORE_SEND:'Recovery stopped; earlier outcome uncertain'};
 return page(`<a class="back" href="/queue">Back to your queue</a><p class="eyebrow">${e(h.reference)} · ${h.status==='HELD'?'Connector hold':'Sample transfer'}</p><section data-state="${h.status==='HELD'?'CONNECTOR_HELD':e(h.status)}"><h1>${title}</h1><p class="intro">${description}</p></section>${error?`<p class="alert" role="alert">${e(holdErrors[error]??'This action could not be completed. Review the current state below.')}</p>`:''}<dl class="facts">${fact('Amount',money(a.amountMinor))}${fact('Currency','Canadian dollars (CAD)')}${fact('From',a.fromAccount)}${fact('To',a.toAccount)}${fact('Requested',time(h.created_at))}${fact('Approval deadline',time(h.expires_at))}</dl>${controls}<details><summary>Inspect recorded events</summary><p class="muted">This view reads saved history only. It sends nothing to Teller. Storage is not claimed to be tamper-proof.</p><ol class="history">${history.events.map((ev:any)=>`<li>${e(eventNames[ev.type]??'Request state recorded')}: ${e(states[ev.holdState]?.[0]??ev.holdState)}<time datetime="${e(ev.occurredAt)}">${e(ev.occurredAt.replace('T',' '))}</time></li>`).join('')}</ol><p>Request key<br><code>${e(h.request_key)}</code></p><p>Saved request hash<br><code>${e(h.body_hash)}</code></p><p>Policy: ${e(h.policy_version)}. ${history.currentPolicyMatches?'Matches the current policy.':'A different policy is now active.'}</p></details><p><a href="/audit/export">Download this session's audit (JSON lines)</a></p><p><a href="/eval">Read the connector evaluation</a></p>`,status);
}
export async function seededPage(request:Request,env:Env,reference:string):Promise<Response>{
 const visitor=await browserSession(env.DB,request);if(!visitor)return pageError('Open your sample session','Start the connection from your MCP client first.',401);
 const registry=await env.DB.prepare('SELECT * FROM sample_registry WHERE visitor_id=? AND epoch=?').bind(visitor.id,visitor.epoch).first<Registry>();
 if(!registry)return pageError('Sample unavailable','Start a fresh sample session.',404);
 const started=Date.now();
 const result=await readTool('get_sample_transfer',{reference},registry,new TellerClient(env.ORIGIN_URL,env.ORIGIN_SIGNING_SECRET,visitor.epoch));
 await recordCall(env.DB,{visitorId:visitor.id,epoch:visitor.epoch},'get_sample_transfer',{reference},result,started);
 if(result.isError)return pageError('Sample unavailable',String((result.content[0] as any).text),503);
 const t=result.structuredContent as any,[title,description]=states[t.status]??states.OUTCOME_UNKNOWN;
 return page(`<a class="back" href="/queue">Back to your queue</a><p class="eyebrow">${e(reference)} · Seeded example</p><section data-state="${e(t.status)}"><h1>${title}</h1><p class="intro">${description}</p></section><dl class="facts">${fact('Amount',money(t.amountMinor))}${fact('Source','Prepared sample data')}${fact('From',t.fromAccount)}${fact('To',t.toAccount)}</dl><p>This example was prepared before your session. Teller's separate approval controls are unavailable in this demo.</p><p class="muted">The sample session identifies a browser. It does not verify a person's identity or enforce two different people.</p><p><a href="/audit/export">Download this session's audit (JSON lines)</a></p><p><a href="/eval">Read the connector evaluation</a></p>`);
}
