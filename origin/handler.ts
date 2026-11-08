import { verifyRequest } from '../packages/signing.ts';
import type { Pool } from '../packages/sample.ts';
import { SAMPLE } from '../packages/sample.ts';
import { InvalidBody, limitedText } from '../packages/body.ts';
import { z } from 'zod';
export type OriginOptions = { secret:string;apiKey:string;pool:Pool;maintenance:boolean;writesEnabled?:boolean;beforeSend?:()=>Promise<boolean>;upstream?:(request:Request)=>Promise<Response> };
export async function originFetch(request:Request,options:OriginOptions):Promise<Response> {
  const safe=(status:number)=>Response.json({...SAMPLE,code:status===403?'ORIGIN_AUTH':'ORIGIN_UNAVAILABLE'},{status});
  if(options.maintenance||options.pool.expiresAt<=Date.now())return safe(503);
  if(!await verifyRequest(request,options.secret,options.pool.epoch))return safe(403);
  const url=new URL(request.url);if(url.search)return safe(404);
  const route=/^\/v1\/pools\/(\d{3})\/(accounts|transfers|requests)(?:\/([a-z0-9-]+))?$/.exec(url.pathname);
  if(!route)return safe(404);
  const [,poolId,kind,alias]=route,entry=options.pool.pools.find(p=>p.poolId===poolId);
  if(!entry)return safe(404);
  const write=request.method==='POST'&&kind==='transfers'&&!alias;
  let path='',body:string|undefined,headers:Record<string,string>={'X-API-Key':options.apiKey,Accept:'application/json'};
  if(write){
    if(options.writesEnabled!==true)return safe(503);
    const key=request.headers.get('Idempotency-Key')??'',approval=request.headers.get('X-Demo-Approval'),until=Number(request.headers.get('X-Demo-Until'));
    const parts=key.split(':');
    if(parts.length!==4||parts[0]!=='demo'||parts[1]!==options.pool.epoch||parts.slice(1).some(p=>!z.uuid().safeParse(p).success)||!z.uuid().safeParse(approval).success||!Number.isSafeInteger(until)||until<=Date.now()||until>options.pool.expiresAt)return safe(403);
    try{
      body=await limitedText(request,16384);
      const parsed=z.strictObject({fromAccountId:z.uuid(),toAccountId:z.uuid(),amountMinor:z.number().int().min(1).max(10000),currency:z.literal('CAD'),initiatedBy:z.literal(`sample:${parts[2]}`)}).parse(JSON.parse(body));
      if(parsed.fromAccountId===parsed.toAccountId||![parsed.fromAccountId,parsed.toAccountId].every(id=>Object.values(entry.accounts).includes(id)))return safe(403);
    }catch{return safe(400);}
    path='/transfers';headers={...headers,'Content-Type':'application/json','Idempotency-Key':key};
  }else{
    if(request.method!=='GET'||request.body||!alias)return safe(404);
    if(kind==='requests'){
      if(!z.uuid().safeParse(alias).success)return safe(404);path=`/transfers/${alias}`;
    }else{
      const catalogue=entry[kind as 'accounts'|'transfers'] as Record<string,string>,id=Object.hasOwn(catalogue,alias)?catalogue[alias]:undefined;
      if(!id)return safe(404);path=`/${kind}/${id}`;
    }
  }
  try{
    if(write&&options.beforeSend&&!await options.beforeSend())return safe(503);
    const response=await (options.upstream??fetch)(new Request(`http://127.0.0.1:18080${path}`,{method:write?'POST':'GET',headers,body,redirect:'manual',signal:AbortSignal.timeout(2500)}));
    if(![200,201].includes(response.status)){
      const result=[204,205,304].includes(response.status)?new Response(null,{status:response.status}):safe(response.status);
      const retry=response.headers.get('Retry-After');if(retry)result.headers.set('Retry-After',retry);return result;
    }
    const text=await limitedText(response);
    // A recovered transfer must still belong to the signed pool. No cross-pool ID reads.
    if(kind==='requests'){
      const data=JSON.parse(text);if(![data.fromAccountId,data.toAccountId].every(id=>Object.values(entry.accounts).includes(id)))return safe(404);
    }
    return new Response(text,{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  }catch(error){
    if(error instanceof InvalidBody){const response=safe(502);response.headers.set('X-Demo-Failure','invalid-data');return response;}
    return safe(503);
  }
}
