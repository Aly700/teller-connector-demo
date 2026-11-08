import { test } from 'node:test';
import assert from 'node:assert/strict';
import { originFetch } from '../origin/handler.ts';
import { signRequest } from '../packages/signing.ts';
import { fixture } from './d1.ts';
import { createHold,decideHold,issueCsrf } from '../packages/gate/holds.ts';
import { dispatchRequest } from '../packages/gate/upstream.ts';
test('origin binds approval, key, body and deadline; independent write switch prevents every POST',async()=>{
 const f=await fixture(),held=await createHold(f.db,f.props,f.input),h=(await decideHold(f.db,f.visitor,held.id,await issueCsrf(f.db,held),held.body_hash,'approve',async()=>true)).hold;
 const secret='a'.repeat(64),accounts=JSON.parse(h.body_json),pool={epoch:h.epoch,expiresAt:f.visitor.expires_at,pools:[{poolId:'001',accounts:{operating:accounts.fromAccountId,reserve:accounts.toAccountId},transfers:{'sample-posted':crypto.randomUUID(),'sample-held':crypto.randomUUID()}}]};
 let posts=0;const options={secret,apiKey:'key',pool,maintenance:false,writesEnabled:true,upstream:async(req:Request)=>{posts++;assert.equal(req.method,'POST');assert.equal(req.headers.get('Idempotency-Key'),h.teller_key);assert.equal(await req.text(),h.body_json);return Response.json({id:crypto.randomUUID()},{status:201});}};
 const request=()=>dispatchRequest('http://localhost',secret,h);
 assert.equal((await originFetch(await request(),{...options,writesEnabled:false})).status,503);
 const changed=await request();assert.equal((await originFetch(new Request(changed,{body:'{}'}),options)).status,403);
 const key=await request();key.headers.set('Idempotency-Key','other');assert.equal((await originFetch(key,options)).status,403);
 const noApproval=await signRequest('http://localhost/v1/pools/001/transfers',secret,h.epoch,'POST');assert.notEqual((await originFetch(noApproval,options)).status,201);
 assert.equal(posts,0);assert.equal((await originFetch(await request(),options)).status,201);assert.equal(posts,1);
 assert.equal((await originFetch(await request(),{...options,beforeSend:async()=>false})).status,503);assert.equal(posts,1);
});
