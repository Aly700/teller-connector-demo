import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { session, base, mcp,decisionForm } from '../tests/helpers.ts';
import { signRequest } from '../packages/signing.ts';
const s = await session();
const old = JSON.parse(await readFile('.data/pool.json', 'utf8'));
const call=async(name:string,args:object)=>(await (await mcp(s.tokens.access_token,'tools/call',{name,arguments:args})).json() as any).result.structuredContent;
const list=await call('list_sample_accounts',{});
const hold=await call('request_sample_transfer',{fromAccount:'operating',toAccount:'reserve',amountMinor:37,currency:'CAD',requestKey:list.requestSlots[0].requestKey});
const details=await decisionForm(hold.approvalUrl,s.cookie);
const pg=process.env.PG_BIN??'/opt/homebrew/opt/postgresql@16/bin';
const pgEnv={...process.env,PGPASSWORD:process.env.DB_PASSWORD};
const blocker=spawn(pg+'/psql',['-X','-At','-v','ON_ERROR_STOP=1'],{env:pgEnv,stdio:['pipe','pipe','pipe']});
const locked=new Promise<void>((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('Account lock timeout')),5000);blocker.stdout.on('data',data=>{output+=data;if(output.includes('LOCKED')){clearTimeout(timer);resolve();}});blocker.once('error',reject);});
blocker.stdin.write(`BEGIN; SELECT id FROM accounts WHERE id='${list.accounts[0].id}' FOR UPDATE; SELECT 'LOCKED';\n`);
await locked;
try {
  const deciding=fetch(hold.approvalUrl,{method:'POST',headers:{Cookie:s.cookie,Origin:base},body:new URLSearchParams({csrf:details.csrf,bodyHash:details.bodyHash,action:'approve'})});
  const countWaiters=()=>Number(execFileSync(pg+'/psql',['-X','-At','-c',"SELECT count(*) FROM pg_stat_activity WHERE datname='teller_demo' AND wait_event_type='Lock' AND application_name='PostgreSQL JDBC Driver'"],{env:pgEnv,encoding:'utf8'}).trim());
  let waiting=false;
  for(let i=0;i<50;i++){if(countWaiters()>0){waiting=true;break;}await new Promise(r=>setTimeout(r,100));}
  assert.ok(waiting,'Teller must have a real transaction blocked on the account');
  const response=await deciding;assert.equal(response.status,200);assert.match(await response.text(),/Result not confirmed/);
  assert.ok(countWaiters()>0,'Upstream transaction must still be live after caller timeout');
  const reset=spawn('scripts/reset.sh',[],{stdio:'inherit',env:process.env});
  const exited=once(reset,'exit');
  setTimeout(()=>blocker.stdin.end('COMMIT;\n'),1500);
  const [code]=await exited;assert.equal(code,0);
  console.log('PASS reset while an approved Teller transaction is still running after caller timeout: write boundary closed, old processes stopped, connections closed before replacement.');
} finally {blocker.stdin.end('ROLLBACK;\n');}

const current = JSON.parse(await readFile('.data/pool.json', 'utf8'));
assert.notEqual(old.epoch, current.epoch);
assert.equal((await mcp(s.tokens.access_token)).status, 401);
assert.equal((await fetch(base + '/guide', { headers: { Cookie: s.cookie } })).status, 401);
const refresh = await fetch(base + '/oauth/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', client_id: s.flow.client.client_id, refresh_token: s.tokens.refresh_token, resource: base + '/mcp' }) });
assert.equal(refresh.status, 401); // Reset also removes the DCR client from KV.
const request = await signRequest('http://127.0.0.1:18081/v1/pools/001/accounts/operating', process.env.ORIGIN_SIGNING_SECRET!, old.epoch);
assert.equal((await fetch(request)).status, 403);
assert.equal((await fetch('http://127.0.0.1:18080/accounts/' + old.pools[0].accounts.operating, { headers: { 'X-API-Key': process.env.TELLER_API_KEY! } })).status, 404);
console.log('PASS repeatable reset: epoch rotated, old token/cookie/refresh/signature refused, old Teller account absent. Sample data. No real money.');
