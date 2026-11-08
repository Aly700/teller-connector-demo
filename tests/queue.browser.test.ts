import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base,session,mcp } from './helpers.ts';
import { chromium } from '../scripts/browser.ts';
import { readFile } from 'node:fs/promises';
const call=async(s:any,name:string,args:object)=>(await (await mcp(s.tokens.access_token,'tools/call',{name,arguments:args})).json() as any).result;
test('queue and detail are browser-owned, keyboard operable, responsive and export complete safe JSON lines',async()=>{
 const s=await session(),other=await session();const list=await call(s,'list_sample_accounts',{});
 const input={fromAccount:'operating',toAccount:'reserve',amountMinor:123,currency:'CAD',requestKey:list.structuredContent.requestSlots[0].requestKey};
 const held=(await call(s,'request_sample_transfer',input)).structuredContent;
 const browser=await chromium.launch();
 try{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.addCookies([{name:'__Host-sample-session',value:/__Host-sample-session=([^;]+)/.exec(s.cookie)![1],domain:'localhost',path:'/',secure:true,httpOnly:true,sameSite:'Lax'}]);
  const page=await context.newPage();const errors:string[]=[];page.on('pageerror',(e:any)=>errors.push(String(e)));
  await page.goto(base+'/queue');assert.match(await page.locator('body').innerText(),/Your sample queue/);
  await page.goto(held.approvalUrl);assert.match(await page.locator('body').innerText(),/Waiting for your approval/);assert.match(await page.locator('body').innerText(),/\$1\.23 CAD/);
  assert.ok(await page.getByText('Sample data. No real money.',{exact:true}).isVisible());
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const before=JSON.parse(await readFile('.data/origin-metrics.json','utf8')).transferPosts;
  const decisionResponse=page.waitForResponse((r:any)=>r.request().method()==='POST');
  const button=page.getByRole('button',{name:'Reject request',exact:true});await button.focus();await page.keyboard.press('Enter');
  const posted=await decisionResponse;assert.equal(await posted.request().headerValue('origin'),base);assert.equal(posted.status(),303,posted.status()===303?'':await posted.text());
  await page.getByRole('heading',{name:'Rejected by you',exact:true}).waitFor();
  assert.equal(JSON.parse(await readFile('.data/origin-metrics.json','utf8')).transferPosts,before);
  assert.equal((await fetch(held.approvalUrl,{headers:{Cookie:other.cookie}})).status,404);
  await call(s,'get_sample_account',{account:'operating',note:'PRIVATE REJECTED TEXT'});
  const exportResponse=await fetch(base+'/audit/export',{headers:{Cookie:s.cookie}});assert.equal(exportResponse.status,200);
  const text=await exportResponse.text();assert.ok(!text.includes('PRIVATE REJECTED TEXT'));assert.ok(!text.includes(s.tokens.access_token));
  const events=text.trim().split('\n').map(line=>JSON.parse(line));assert.ok(events.length>=4);
  const fields=['eventId','occurredAt','sampleData','visitorId','epoch','tool','annotations','requestKey','argumentHash','arguments','policyVersion','policyRule','policyEffect','holdId','holdState','approver','approvedAt','attemptId','replayId','upstreamStatus','errorCode','latencyMs','tellerTransferId','sequence'];
  for(const event of events){for(const field of fields)assert.ok(field in event,field);assert.equal(event.visitorId,s.tokens.access_token.split(':')[0]);}
  assert.equal(events.filter(e=>e.holdId===held.holdId&&e.type==='DENIED').length,1);
  const foreign=await (await fetch(base+'/audit/export',{headers:{Cookie:other.cookie}})).text();assert.ok(!foreign.includes(held.holdId));
  assert.equal((await fetch(base+'/audit/export',{headers:{Authorization:'Bearer '+s.tokens.access_token}})).status,401);
  assert.equal((await fetch(base+'/audit/export?from=bad&to=bad',{headers:{Cookie:s.cookie}})).status,400);
  const future=new URLSearchParams({from:new Date(Date.now()+60000).toISOString(),to:new Date(Date.now()+120000).toISOString()});
  assert.equal(await (await fetch(base+'/audit/export?'+future,{headers:{Cookie:s.cookie}})).text(),'');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
