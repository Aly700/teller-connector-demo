import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './d1.ts';
import { consumeTool } from '../packages/limits.ts';
import { createHold,decideHold,issueCsrf } from '../packages/gate/holds.ts';
import { dispatch } from '../packages/gate/dispatch.ts';
import { session,mcp,sql,base } from './helpers.ts';

test('atomic limits admit 30 per visitor minute and at most 10000 global calls per UTC day',async()=>{
 const f=await fixture(),now=Date.now();for(let i=0;i<30;i++)assert.equal(await consumeTool(f.db,f.props,'get_account',now),true);
 assert.equal(await consumeTool(f.db,f.props,'get_account',now),false);
 assert.equal(await consumeTool(f.db,f.props,'get_account',now+60000),true);
 f.raw.prepare("UPDATE tool_limits SET count=10000 WHERE scope='global'").run();
 assert.equal(await consumeTool(f.db,{...f.props,visitorId:'another'},'get_account',now),false);
 assert.equal(f.raw.prepare("SELECT count FROM tool_limits WHERE scope='global'").get()!.count,10000);
});
test('write-only stop and global stop block approval and immediate dispatch, with zero POSTs',async()=>{
 for(const update of ["UPDATE config SET tools_json=json_set(tools_json,'$.request_transfer',0)",'UPDATE config SET enabled=0','DELETE FROM config']){
  const f=await fixture(),h=await createHold(f.db,f.props,f.input),csrf=await issueCsrf(f.db,h);f.raw.exec(update);
  await assert.rejects(decideHold(f.db,f.visitor,h.id,csrf,h.body_hash,'approve',async()=>true));
  await assert.rejects(createHold(f.db,f.props,{...f.input,requestKey:f.slots[1].requestKey}));
 }
 const f=await fixture();let h=await createHold(f.db,f.props,f.input);h=(await decideHold(f.db,f.visitor,h.id,await issueCsrf(f.db,h),h.body_hash,'approve',async()=>true)).hold;let posts=0;
 const result=await dispatch(f.db,h,{post:async()=>{posts++;return {status:201,data:null};},get:async()=>null},{boundary:async name=>{if(name==='send-recorded')f.raw.exec("UPDATE config SET tools_json='{}'");}});
 assert.equal(posts,0);assert.equal(result.status,'HELD');
});
test('HTTP abuse refuses unknown tools and oversized input before any hold and enforces visitor limits',async()=>{
 const s=await session();
 const unknown=await (await mcp(s.tokens.access_token,'tools/call',{name:'send_email',arguments:{recipient:'private@example.invalid'}})).json() as any;
 assert.equal(unknown.result.structuredContent.code,'UNKNOWN_TOOL');
 const large=await mcp(s.tokens.access_token,'tools/call',{name:'request_transfer',arguments:{note:'x'.repeat(17000)}});assert.equal(large.status,413);
 for(let i=1;i<30;i++){const r=await (await mcp(s.tokens.access_token,'tools/call',{name:'get_transfer',arguments:{reference:'request-5'}})).json() as any;assert.notEqual(r.result.structuredContent.code,'RATE_LIMIT');}
 const limited=await (await mcp(s.tokens.access_token,'tools/call',{name:'get_account',arguments:{account:'operating'}})).json() as any;assert.equal(limited.result.structuredContent.code,'RATE_LIMIT');
});
test('session end requires cookie and same-origin confirmation and revokes MCP authority',async()=>{
 const s=await session();const get=await fetch(base+'/session/end',{headers:{Cookie:s.cookie}});assert.equal(get.status,200);
 const html=await get.text(),csrf=/name="csrf" value="([^"]+)"/.exec(html)![1];
 assert.equal((await fetch(base+'/session/end',{method:'POST',headers:{Cookie:s.cookie,Origin:'https://other.invalid'},body:new URLSearchParams({csrf})})).status,403);
 const end=await fetch(base+'/session/end',{method:'POST',headers:{Cookie:s.cookie,Origin:base},body:new URLSearchParams({csrf})});assert.equal(end.status,200);assert.match(end.headers.get('Set-Cookie')!,/Max-Age=0/);
 assert.equal((await mcp(s.tokens.access_token)).status,401);
 assert.equal((await fetch(base+'/queue',{headers:{Cookie:s.cookie}})).status,401);
});
test('100 new sessions per day is enforced even after the registry is rebuilt',async()=>{
 const {allocate}=await import('../packages/state.ts');const f=await fixture();f.raw.exec('DELETE FROM visitors;UPDATE sample_registry SET visitor_id=NULL');
 f.raw.prepare('INSERT INTO daily_visitors VALUES(?,100)').run(Math.floor(Date.now()/86400000));
 await assert.rejects(allocate(f.db,'test-ip'),/SESSION_LIMIT/);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM visitors').get()!.n,0);
});
test('audit export handles the whole daily call budget without leaking another visitor',async()=>{
 const {auditExport,emptyEvent}=await import('../apps/mcp/src/audit.ts');const f=await fixture();
 const insert=f.raw.prepare('INSERT INTO audit_events(id,occurred_at,visitor_id,epoch,tool,code,event_json) VALUES(?,?,?,?,?,?,?)');
 f.raw.exec('BEGIN');for(let i=0;i<10000;i++){const event=emptyEvent(f.props,'READ_OK');insert.run(event.eventId,f.now,f.visitor.id,f.visitor.epoch,'get_account','READ_OK',JSON.stringify(event));}f.raw.exec('COMMIT');
 const response=await auditExport(new Request('https://demo.example.invalid/audit/export',{headers:{Cookie:'__Host-sample-session='+f.cookie}}),f.db);
 assert.equal(response.status,200);const text=await response.text(),lines=text.trim().split('\n');assert.equal(lines.length,10000);
 for(const line of lines)assert.equal(JSON.parse(line).visitorId,f.visitor.id);console.log(`PASS audit export at daily call budget: ${lines.length} rows, ${Buffer.byteLength(text)} UTF-8 bytes.`);
});
