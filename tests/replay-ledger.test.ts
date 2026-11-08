import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile,rm } from 'node:fs/promises';
import { fork,execFileSync } from 'node:child_process';
import { fixture } from './d1.ts';
import { createHold,decideHold,getHold,issueCsrf } from '../packages/gate/holds.ts';
import { dispatch,watchdog } from '../packages/gate/dispatch.ts';
import { claimReplay } from '../packages/gate/replay.ts';
import { upstreamIO } from '../packages/gate/upstream.ts';
const pg=process.env.PG_BIN??'/opt/homebrew/opt/postgresql@16/bin';
export function ledger(key:string){return JSON.parse(execFileSync(pg+'/psql',['-X','-At','-c',`SELECT json_build_object('transfers',count(DISTINCT t.id),'postings',count(DISTINCT e.posting_id),'entries',count(e.id),'net',coalesce(sum(CASE WHEN e.direction='DEBIT' THEN -e.amount_minor ELSE e.amount_minor END),0)) FROM transfers t LEFT JOIN entries e ON e.transfer_id=t.id WHERE t.idempotency_key='${key}'`],{env:{...process.env,PGPASSWORD:process.env.DB_PASSWORD},encoding:'utf8'}));}
test('SIGKILL at every dispatch boundary recovers one real Teller transfer and one balanced ledger posting',async()=>{
 const pool=JSON.parse(await readFile('.data/pool.json','utf8')),entry=pool.pools[99];
 for(const boundary of ['claimed','send-recorded','before-send','response-received','response-saved','before-result','result-saved']){
  const path=`.data/crash-${crypto.randomUUID()}.sqlite`,f=await fixture(path);
  f.raw.prepare('UPDATE config SET epoch=?,expires_at=?').run(pool.epoch,pool.expiresAt);
  f.raw.prepare('UPDATE visitors SET epoch=?,expires_at=?').run(pool.epoch,pool.expiresAt);
  f.raw.prepare('UPDATE sample_registry SET epoch=?,pool_id=?,accounts_json=?').run(pool.epoch,entry.poolId,JSON.stringify(entry.accounts));
  f.props.epoch=pool.epoch;f.visitor.epoch=pool.epoch;
  let h=await createHold(f.db,f.props,f.input);
  assert.deepEqual(ledger(h.teller_key),{transfers:0,postings:0,entries:0,net:0});
  h=(await decideHold(f.db,f.visitor,h.id,await issueCsrf(f.db,h),h.body_hash,'approve',async()=>true)).hold;
  const child=fork('tests/dispatch-child.ts',[path,h.id,boundary],{execArgv:['--import','tsx'],stdio:['ignore','pipe','pipe','ipc']});
  let stderr='';child.stderr?.on('data',d=>stderr+=d);
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Boundary timeout: '+boundary+' '+stderr));},15000);child.once('message',()=>{clearTimeout(timer);resolve();});child.once('exit',code=>{if(code!==null){clearTimeout(timer);reject(new Error('Unexpected exit '+code+' '+stderr));}});});
  const killed=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGKILL');await killed;
  await watchdog(f.db,Date.now()+31000);h=(await getHold(f.db,f.visitor,h.id))!;
  assert.ok(['POSTED','OUTCOME_UNKNOWN'].includes(h.status));assert.ok(ledger(h.teller_key).postings<=1);
  if(h.status==='OUTCOME_UNKNOWN'){h=await claimReplay(f.db,f.visitor,h.id,await issueCsrf(f.db,h),h.body_hash,true);await dispatch(f.db,h,upstreamIO('http://127.0.0.1:18081',process.env.ORIGIN_SIGNING_SECRET!,h.epoch));}
  h=(await getHold(f.db,f.visitor,h.id))!;assert.equal(h.status,'POSTED',boundary);
  assert.deepEqual(ledger(h.teller_key),{transfers:1,postings:1,entries:2,net:0});
  console.log(`PASS SIGKILL ${boundary}: one transfer, one posting, two balanced entries; same key retained.`);
  f.raw.close();await rm(path);
 }
});
