import { dispatch,watchdog } from '../../../packages/gate/dispatch.ts';
import { claimReplay } from '../../../packages/gate/replay.ts';
import { upstreamIO } from '../../../packages/gate/upstream.ts';
import { browserSession } from '../../../packages/state.ts';
import { getHold,decideHold } from '../../../packages/gate/holds.ts';
import { TellerClient,accountSchema } from './teller.ts';
import { detailPage,pageError } from './pages.ts';
import { securityEvent } from './audit.ts';
import type { Env } from './auth.ts';
export async function decisionRoute(request:Request,env:Env,id:string):Promise<Response>{
 const visitor=await browserSession(env.DB,request);
 if(!visitor)return pageError('Open your sample session','An MCP token or a copied link cannot approve a request. Use the browser where you started the connection.',401);
 const props={visitorId:visitor.id,epoch:visitor.epoch};
 const hold=await getHold(env.DB,visitor,id);
 if(!hold){await securityEvent(env.DB,props,'NOT_FOUND');return pageError('Request not found','This request is not part of your current sample session.',404);}
 if(request.method==='GET'){await watchdog(env.DB,Date.now(),visitor);return detailPage(request,env,id);}
 if(request.method!=='POST')return pageError('Method not allowed','Open the request to review it.',405);
 if(request.headers.get('Origin')!==env.PUBLIC_ORIGIN){await securityEvent(env.DB,props,'INVALID_ORIGIN');return pageError('Action refused','Open the request again from your sample queue.',403);}
 try{
  const form=await request.formData();
  if([...form.keys()].some(k=>!['csrf','bodyHash','action','confirmed'].includes(k))||!['approve','deny','replay'].includes(String(form.get('action'))))throw new Error('INVALID_INPUT');
  const io=upstreamIO(env.ORIGIN_URL,env.ORIGIN_SIGNING_SECRET,visitor.epoch);
  if(form.get('action')==='replay'){
   const claim=await claimReplay(env.DB,visitor,id,String(form.get('csrf')??''),String(form.get('bodyHash')??''),form.get('confirmed')==='yes');
   await dispatch(env.DB,claim,io);
  }else{
   const teller=new TellerClient(env.ORIGIN_URL,env.ORIGIN_SIGNING_SECRET,visitor.epoch);
   const result=await decideHold(env.DB,visitor,id,String(form.get('csrf')??''),String(form.get('bodyHash')??''),form.get('action') as 'approve'|'deny',async()=>{await teller.get(`/v1/pools/${hold.pool_id}/accounts/operating`,accountSchema);return true;});
   if(result.claimed)await dispatch(env.DB,result.hold,io);
   else if(result.hold.error_code==='HELD_UNAVAILABLE')return detailPage(request,env,id,'HELD_UNAVAILABLE',503);
  }
  return new Response(null,{status:303,headers:{Location:`${env.PUBLIC_ORIGIN}/queue/${id}`,'Cache-Control':'no-store'}});
 }catch(error){
  const code=error instanceof Error&&['STALE_ACTION','INSPECTION_ONLY','INVALID_INPUT','PAYLOAD_MISMATCH'].includes(error.message)?error.message:'OUTCOME_UNKNOWN';
  await securityEvent(env.DB,props,code,hold);
  return detailPage(request,env,id,code,409);
 }
}
