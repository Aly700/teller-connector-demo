import { signRequest } from '../signing.ts';
import { limitedText } from '../body.ts';
import { TellerClient,transferSchema } from '../../apps/mcp/src/teller.ts';
import type { Hold } from './holds.ts';
import type { DispatchIO } from './dispatch.ts';
export function dispatchRequest(origin:string,secret:string,h:Hold) {
  if(h.status!=='DISPATCHING'||!h.attempt_id||!h.approver||!h.approved_at)throw new Error('APPROVAL_REQUIRED');
  return signRequest(`${origin}/v1/pools/${h.pool_id}/transfers`,secret,h.epoch,'POST',h.body_json,{
    'Content-Type':'application/json','Idempotency-Key':h.teller_key,'X-Demo-Approval':h.attempt_id,'X-Demo-Until':String(Math.min(Date.now()+10000,h.expires_at)),
  });
}
export function upstreamIO(origin:string,secret:string,epoch:string):DispatchIO {
  const read=new TellerClient(origin,secret,epoch);
  return {
    async post(h){
      const req=await dispatchRequest(origin,secret,h);
      // Exactly one network invocation. Never share the GET retry loop with this path.
      const response=await fetch(new Request(req,{redirect:'manual',signal:AbortSignal.timeout(5000)}));
      if(![200,201].includes(response.status)){await response.body?.cancel();return {status:response.status,data:null};}
      return {status:response.status,data:JSON.parse(await limitedText(response))};
    },
    async get(h){
      const result=await read.get(`/v1/pools/${h.pool_id}/requests/${h.teller_id}`,transferSchema),body=JSON.parse(h.body_json);
      if(result.id!==h.teller_id||result.fromAccountId!==body.fromAccountId||result.toAccountId!==body.toAccountId||result.amountMinor!==body.amountMinor||result.currency!==body.currency)throw new Error('UPSTREAM_CONTRACT');
      return result;
    },
  };
}
