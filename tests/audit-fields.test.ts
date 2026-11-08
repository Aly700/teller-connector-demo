import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './d1.ts';
import { readTool } from '../apps/mcp/src/tools.ts';
import { TellerClient } from '../apps/mcp/src/teller.ts';
import { recordCall } from '../apps/mcp/src/audit.ts';
import type { Registry } from '../packages/state.ts';
test('audit preserves known upstream status for failed reads without storing rejected text',async()=>{
 const f=await fixture(),registry=(await f.db.prepare('SELECT * FROM sample_registry').first<Registry>())!;
 for(const status of [400,401,403,404,409,418]){
  const result=await readTool('get_sample_account',{account:'operating'},registry,new TellerClient('http://localhost','x'.repeat(64),f.props.epoch,{fetcher:async()=>new Response('SECRET SQL',{status})}));
  await recordCall(f.db,f.props,'get_sample_account',{account:'operating'},result,Date.now());
  const rows=f.raw.prepare('SELECT event_json FROM audit_events ORDER BY rowid DESC LIMIT 1').get()!;
  const event=JSON.parse(String(rows.event_json));assert.equal(event.upstreamStatus,status);assert.ok(!String(rows.event_json).includes('SECRET'));
 }
});
