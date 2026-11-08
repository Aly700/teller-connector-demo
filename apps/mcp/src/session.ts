import { browserSession,browserCookie,hash } from '../../../packages/state.ts';
import { retireBrowserSession } from '../../../packages/gate/holds.ts';
import { securityEvent } from '../../../packages/limits.ts';
import { page,safeHttp } from '../../../packages/http.ts';
export async function endSession(request:Request,db:D1Database,origin:string){
 const visitor=await browserSession(db,request);if(!visitor)return page('<h1>No active sample session</h1>',401);
 if(request.method==='GET'){
  const csrf=crypto.randomUUID()+crypto.randomUUID();
  await db.prepare('INSERT INTO session_end_tokens VALUES(?,?,?,?) ON CONFLICT(visitor_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at').bind(visitor.id,visitor.epoch,await hash(csrf),Date.now()+300000).run();
  return page(`<h1>End this sample session</h1><p>This revokes the browser session and its connector access. Pending requests expire. A transfer already sent to Teller cannot be undone here.</p><form method="post"><input type="hidden" name="csrf" value="${csrf}"><button>End sample session</button></form><p><a href="/queue">Return to your queue</a></p>`);
 }
 if(request.method!=='POST')return safeHttp('METHOD_NOT_ALLOWED',405);
 if(request.headers.get('Origin')!==origin)return safeHttp('INVALID_ORIGIN',403);
 const form=await request.formData(),token=form.get('csrf');if(typeof token!=='string')return safeHttp('INVALID_ACTION',403);
 const changed=await db.batch([
  db.prepare('UPDATE visitors SET revoked=1 WHERE id=? AND epoch=? AND revoked=0 AND EXISTS(SELECT 1 FROM session_end_tokens WHERE visitor_id=? AND epoch=? AND token_hash=? AND expires_at>?) RETURNING id').bind(visitor.id,visitor.epoch,visitor.id,visitor.epoch,await hash(token),Date.now()),
  db.prepare('DELETE FROM session_end_tokens WHERE visitor_id=? AND EXISTS(SELECT 1 FROM visitors WHERE id=? AND revoked=1)').bind(visitor.id,visitor.id),
 ]);
 if(!changed[0].results.length)return safeHttp('INVALID_ACTION',403);
 await retireBrowserSession(db,visitor);await securityEvent(db,'SESSION_ENDED',{visitorId:visitor.id,epoch:visitor.epoch});
 return page('<h1>Sample session ended</h1><p>Your connector token and browser session can no longer act. Start a new session from your MCP client when you want to try again.</p>',200,new Headers({'Set-Cookie':browserCookie('',0)}));
}
