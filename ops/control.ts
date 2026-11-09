import { execFileSync } from 'node:child_process';
import { readFileSync,writeFileSync,renameSync,existsSync } from 'node:fs';
const command=process.argv[2],cli='node_modules/wrangler/bin/wrangler.js';
const run=(args:string[])=>execFileSync(process.execPath,[cli,...args],{encoding:'utf8',env:process.env});
const sql=(value:string)=>JSON.parse(run(['d1','execute','DB','--remote','--env','production','--command',value,'--json']))[0].results;
function writeOff(){const state=existsSync('.data/origin-state.json')?JSON.parse(readFileSync('.data/origin-state.json','utf8')):{maintenance:true};state.writesEnabled=false;writeFileSync('.data/origin-state.json.next',JSON.stringify(state),{mode:0o600});renameSync('.data/origin-state.json.next','.data/origin-state.json');}
function event(code:string){sql(`INSERT INTO audit_events(id,occurred_at,code) VALUES('${crypto.randomUUID()}',${Date.now()},'${code}')`);}
if(command==='stop-writes'||command==='stop-all'||command==='maintenance'){
 writeOff();
 if(command==='maintenance')execFileSync(process.execPath,['--import','tsx','scripts/worker-state.ts','maintenance'],{stdio:'inherit',env:process.env});
 else sql(command==='stop-all'?'UPDATE config SET enabled=0 WHERE id=1':"UPDATE config SET tools_json=json_set(tools_json,'$.request_transfer',json('false')) WHERE id=1");
 event(command==='stop-all'?'DEMO_DISABLED':command==='maintenance'?'MAINTENANCE':'WRITES_DISABLED');
 console.log('Origin writes are off. Durable switch saved. Already-sent requests still need reconciliation.');
}else if(command==='resume-writes'){
 const pool=JSON.parse(readFileSync('.data/pool.json','utf8')),state=JSON.parse(readFileSync('.data/origin-state.json','utf8'));
 const config=sql('SELECT epoch,expires_at,maintenance FROM config WHERE id=1')[0];
 if(!config||config.epoch!==pool.epoch||config.expires_at<=Date.now()||config.maintenance||state.maintenance||state.epoch!==pool.epoch)throw new Error('Reset and health check required');
 sql("UPDATE config SET enabled=1,tools_json=json_set(tools_json,'$.request_transfer',json('true')) WHERE id=1");
 state.writesEnabled=true;writeFileSync('.data/origin-state.json.next',JSON.stringify(state),{mode:0o600});renameSync('.data/origin-state.json.next','.data/origin-state.json');event('WRITES_ENABLED');console.log('Sample writes enabled for the current epoch.');
}else if(command==='status'){
 const rows=sql('SELECT enabled,maintenance,expires_at FROM config WHERE id=1');console.log(JSON.stringify(rows));
}else throw new Error('Expected stop-writes, stop-all, maintenance, resume-writes or status');
