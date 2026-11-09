import { acceptedArguments } from '../apps/mcp/src/tools.ts';
import { transferInput } from '../packages/gate/holds.ts';
export type Selection={tool:string;arguments:Record<string,unknown>}|{refusal:string};
export interface EvalCase {version:1;id:string;family:string;kind:'read'|'refuse'|'hold';prompt:string;context:Record<string,any>;expected:{selection:Selection;runtime:Record<string,any>};fault?:{status:number};after?:string;failureMode?:string;probe?:{tool:string;arguments:Record<string,unknown>}}
export interface CaseResult {id:string;pass:boolean;invalid:boolean;selection:Selection|null;actual:Record<string,any>|null;error:string|null;latencyMs:number;inputTokens:number;outputTokens:number}
export interface Report {version:1;id:string;kind:'model'|'stub';model:string;returnedModels:string[];caseHash:string;revision:string;trigger:'manual'|'scheduled'|'push';startedAt:number;completedAt:number|null;runtime:'local-real-teller'|'test-fixtures';results:CaseResult[];costMicrousd:number;uncertainCost:boolean;cases:EvalCase[]}
export const names=['list_accounts','get_account','get_transfer','request_transfer'];
export function exact(a:unknown,b:unknown):boolean {
 if(a===b)return true;if(typeof a!==typeof b||!a||!b||typeof a!=='object')return false;
 if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>exact(v,b[i]));
 const x=a as Record<string,unknown>,y=b as Record<string,unknown>,keys=Object.keys(x).sort();return exact(keys,Object.keys(y).sort())&&keys.every(k=>exact(x[k],y[k]));
}
export function parseSelection(content:unknown):{valid:boolean;selection:Selection|null}{
 if(!Array.isArray(content))return {valid:false,selection:null};
 const calls=content.filter(c=>c?.type==='tool_use');
 if(calls.length===1&&names.includes(calls[0].name)&&calls[0].input&&typeof calls[0].input==='object'&&!Array.isArray(calls[0].input)&&content.every(c=>['text','tool_use'].includes(c?.type))){const c=calls[0];if(c.name==='request_transfer'?transferInput.safeParse(c.input).success:acceptedArguments(c.name,c.input)!==null)return {valid:true,selection:{tool:c.name,arguments:c.input}};}
 if(calls.length===0&&content.length===1&&content[0]?.type==='text')try{const value=JSON.parse(content[0].text);if(value&&Object.keys(value).length===1&&typeof value.refusal==='string'&&/^[A-Z_]{1,64}$/.test(value.refusal))return {valid:true,selection:value};}catch{}
 return {valid:false,selection:null};
}
