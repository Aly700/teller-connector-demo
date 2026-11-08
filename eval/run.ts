import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { exact,parseSelection,type EvalCase,type Report } from './contracts.ts';
export { exact,parseSelection,type EvalCase } from './contracts.ts';
export interface ProviderReply {model:string;inputTokens:number;outputTokens:number;content:unknown}
export interface Provider {kind:'model'|'stub';model:string;call(c:EvalCase):Promise<ProviderReply>}
export interface Runtime {kind:Report['runtime'];run(c:EvalCase):Promise<Record<string,any>>}
export function loadCases():EvalCase[]{
 const raw=readFileSync(new URL('cases.jsonl',import.meta.url),'utf8');
 if(createHash('sha256').update(raw).digest('hex')!==readFileSync(new URL('cases.sha256',import.meta.url),'utf8').trim())throw new Error('CASE_SET_CHANGED');
 const cases=raw.trim().split('\n').map(line=>JSON.parse(line));if(cases.length!==80)throw new Error('CASE_COUNT');return cases;
}
export const caseHash=()=>createHash('sha256').update(readFileSync(new URL('cases.jsonl',import.meta.url))).digest('hex');
export async function runEval(cases:EvalCase[],provider:Provider,runtime:Runtime,options:{revision:string;trigger:Report['trigger'];id?:string;startedAt?:number;checkpoint?:(r:Report)=>Promise<void>}):Promise<Report>{
 if(provider.kind==='model'&&runtime.kind!=='local-real-teller')throw new Error('REAL_RUNTIME_REQUIRED');
 if(cases.length!==80)throw new Error('CASE_COUNT');
 const report:Report={version:1,id:options.id??crypto.randomUUID(),kind:provider.kind,model:provider.model,returnedModels:[],caseHash:caseHash(),revision:options.revision,trigger:options.trigger,startedAt:options.startedAt??Date.now(),completedAt:null,runtime:runtime.kind,results:[],costMicrousd:0,uncertainCost:false,cases};
 for(const c of cases){
  if(report.costMicrousd+1250>100000)break;
  const start=Date.now();let selection=null,invalid=false,actual=null,error=null,inputTokens=0,outputTokens=0,accounted=false;
  try{
   const reply=await provider.call(c);inputTokens=reply.inputTokens;outputTokens=reply.outputTokens;
   if(!Number.isSafeInteger(inputTokens)||inputTokens<0||inputTokens>9000||!Number.isSafeInteger(outputTokens)||outputTokens<0||outputTokens>256)throw new Error('USAGE_LIMIT');
   report.costMicrousd+=Math.ceil(inputTokens*0.1+outputTokens*0.5);accounted=true;
   if(!report.returnedModels.includes(reply.model))report.returnedModels.push(reply.model);
   if(reply.model!==provider.model)throw new Error('MODEL_MISMATCH');
   const parsed=parseSelection(reply.content);selection=parsed.selection;invalid=!parsed.valid;
   if(parsed.valid&&exact(selection,c.expected.selection))actual=await runtime.run(c);
  }catch(e){error=['MODEL_MISMATCH','USAGE_LIMIT','MODEL_UNAVAILABLE'].includes((e as Error).message)?(e as Error).message:'CASE_FAILED';invalid=true;report.uncertainCost=true;if(!accounted)report.costMicrousd+=1250;}
  report.results.push({id:c.id,pass:!invalid&&exact(selection,c.expected.selection)&&exact(actual,c.expected.runtime),invalid,selection,actual,error,latencyMs:Date.now()-start,inputTokens,outputTokens});
  // Each attempt stays in its original denominator. No automatic model retries.
  if(report.costMicrousd>98750||error==='USAGE_LIMIT'||error==='MODEL_MISMATCH'||error==='MODEL_UNAVAILABLE')break;
  await options.checkpoint?.(report);
 }
 if(report.results.length===80)report.completedAt=Date.now();await options.checkpoint?.(report);return report;
}
