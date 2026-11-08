import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { loadCases,runEval,caseHash } from './run.ts';
import { AnthropicProvider } from './provider.ts';
import { fixtureRuntime } from './runtime.ts';
import type { Report } from './contracts.ts';
const origin=process.env.EVAL_REPORT_ORIGIN,secret=process.env.EVAL_REPORT_SECRET,model=process.env.EVAL_MODEL_ID;
if(!origin||!secret||!model)throw new Error('Set EVAL_REPORT_ORIGIN, EVAL_REPORT_SECRET and a verified EVAL_MODEL_ID. No model was called.');
const url=new URL(origin);if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw new Error('HTTPS_REPORT_ORIGIN_REQUIRED');
const trigger=(process.env.EVAL_TRIGGER??'manual') as Report['trigger'];
async function send(path:string,body:unknown){const r=await fetch(origin+path,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',Authorization:'Bearer '+secret},body:JSON.stringify(body)});if(!r.ok)throw new Error(`REPORT_HTTP_${r.status}`);return r.json() as Promise<any>;}
if(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim())throw new Error('CLEAN_REVISION_REQUIRED');
const reservation=await send('/internal/eval/reserve',{model,trigger});
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
let last:Report={version:1,id:reservation.id,kind:'model',model,returnedModels:[],caseHash:caseHash(),revision,trigger,startedAt:reservation.startedAt,completedAt:null,runtime:'local-real-teller',results:[],costMicrousd:0,uncertainCost:false,cases:loadCases()};
const save=async(r:Report)=>{last=structuredClone(r);writeFileSync('.data/eval-report.json',JSON.stringify(r,null,2)+'\n',{mode:0o600});await send('/internal/eval/report',r);};
try{
 await save(last);
 const key=process.env.ANTHROPIC_API_KEY;if(!key)throw new Error('ANTHROPIC_API_KEY_MISSING');
 const report=await runEval(last.cases,new AnthropicProvider(model,key),fixtureRuntime(true),{id:last.id,startedAt:last.startedAt,revision,trigger,checkpoint:save});
 const pass=report.results.filter(r=>r.pass).length,invalid=report.results.filter(r=>r.invalid).length;
 console.log(`Real run: ${pass}/80 exact; ${invalid} invalid; ${report.completedAt===null?'incomplete':'complete'}.`);
 if(report.completedAt===null||pass<76||invalid||report.cases.some(c=>c.kind!=='read'&&!report.results.find(r=>r.id===c.id)?.pass))process.exitCode=1;
}catch(e){if(last.completedAt===null)await save(last);throw e;}
