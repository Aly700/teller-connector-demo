import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { session,mcp,base,sql,begin,approve,decisionForm } from './helpers.ts';
async function call(s:any,name:string,args:object){return (await (await mcp(s.tokens.access_token,'tools/call',{name,arguments:args})).json() as any).result;}
test('MCP request is held in real D1, scoped to its browser, and rejects forged approval and missing scope',async()=>{
  const before=JSON.parse(await readFile('.data/origin-metrics.json','utf8')).transferPosts;
  const s=await session(),other=await session(),readOnly=await session('sample:read');
  const list=await call(s,'list_accounts',{}),key=list.structuredContent.requestSlots[0].requestKey;
  const args={fromAccount:'operating',toAccount:'reserve',amountMinor:100,currency:'CAD',requestKey:key};
  assert.equal((await call(s,'request_transfer',{...args,approved:true})).structuredContent.code,'INVALID_INPUT');
  assert.equal((await mcp(readOnly.tokens.access_token,'tools/call',{name:'request_transfer',arguments:args})).status,403);
  const result=await call(s,'request_transfer',args);assert.ok(!result.isError);const h=result.structuredContent;
  assert.equal(h.status,'HELD');assert.equal((await call(s,'request_transfer',args)).structuredContent.holdId,h.holdId);
  assert.equal((await call(other,'request_transfer',args)).structuredContent.code,'INVALID_INPUT');
  assert.equal((await fetch(h.approvalUrl,{headers:{Cookie:other.cookie}})).status,404);
  assert.equal((await fetch(h.approvalUrl,{method:'POST',headers:{Origin:base,Authorization:'Bearer '+s.tokens.access_token},body:new URLSearchParams({action:'approve'})})).status,401);
  assert.equal((await call(s,'get_transfer',{reference:h.reference})).structuredContent.status,'HELD');
  const page=await fetch(h.approvalUrl,{headers:{Cookie:s.cookie}});assert.equal(page.status,200);
  const details=await decisionForm(h.approvalUrl,s.cookie);
  const form=new URLSearchParams({csrf:details.csrf,bodyHash:details.bodyHash,action:'deny'});
  const decision=await fetch(h.approvalUrl,{method:'POST',redirect:'manual',headers:{Cookie:s.cookie,Origin:base},body:form});assert.equal(decision.status,303);
  assert.equal((await call(s,'request_transfer',args)).structuredContent.status,'DENIED');
  assert.equal((await fetch(h.approvalUrl,{method:'POST',redirect:'manual',headers:{Cookie:s.cookie,Origin:base},body:form})).status,409);
  const rows=sql(`SELECT status,teller_id,journal_json FROM holds WHERE id='${h.holdId}';`)[0].results;
  assert.equal(rows[0].teller_id,null);assert.equal(JSON.parse(rows[0].journal_json).length,2);
  assert.equal(JSON.parse(await readFile('.data/origin-metrics.json','utf8')).transferPosts,before,'zero transfer POSTs before approval, denial and stale token');
});
test('replacing a browser session revokes its previous authority and expires pending holds',async()=>{
  const old=await session(),list=await call(old,'list_accounts',{});
  const held=(await call(old,'request_transfer',{fromAccount:'operating',toAccount:'reserve',amountMinor:1,currency:'CAD',requestKey:list.structuredContent.requestSlots[0].requestKey})).structuredContent;
  const flow=await begin();assert.equal((await approve(flow,{cookie:flow.cookie+'; '+old.cookie})).status,302);
  assert.equal((await mcp(old.tokens.access_token)).status,401);
  assert.equal(sql(`SELECT status FROM holds WHERE id='${held.holdId}'`)[0].results[0].status,'EXPIRED');
});
test('a stale browser decision cannot invalidate a newer one-use token',async()=>{
 const s=await session(),list=await call(s,'list_accounts',{});
 const h=(await call(s,'request_transfer',{fromAccount:'operating',toAccount:'reserve',amountMinor:5,currency:'CAD',requestKey:list.structuredContent.requestSlots[0].requestKey})).structuredContent;
 const a=await decisionForm(h.approvalUrl,s.cookie),b=await decisionForm(h.approvalUrl,s.cookie);
 const post=(form:any)=>fetch(h.approvalUrl,{method:'POST',redirect:'manual',headers:{Cookie:s.cookie,Origin:base},body:new URLSearchParams({csrf:form.csrf,bodyHash:form.bodyHash,action:'deny'})});
 assert.equal((await post(a)).status,409);assert.equal((await post(b)).status,303);
});
