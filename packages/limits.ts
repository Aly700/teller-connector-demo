import { hash,type SessionProps } from './state.ts';
export const TOOL_MINUTE_LIMIT = 30;
export const TOOL_DAY_LIMIT = 10000;
export const TOOL_MINUTE_MS = 60000;
export const TOOL_DAY_MS = 86400000;
export async function securityEvent(db:D1Database,code:'RATE_LIMIT'|'UNKNOWN_TOOL'|'TOO_LARGE'|'SESSION_ENDED'|'AUTH_FAILURE',props?:SessionProps,now=Date.now()){
 const id=await hash(`${code}:${props?.visitorId??'edge'}:${Math.floor(now/60000)}`);
 await db.prepare('INSERT INTO audit_events(id,occurred_at,visitor_id,epoch,tool,code) VALUES(?,?,?,?,NULL,?) ON CONFLICT(id) DO NOTHING').bind(id,now,props?.visitorId??null,props?.epoch??null,code).run();
}
export async function consumeTool(db:D1Database,props:SessionProps,_tool:string,now=Date.now()):Promise<boolean>{
 const day=Math.floor(now/TOOL_DAY_MS),minute=Math.floor(now/TOOL_MINUTE_MS),scope=`visitor:${props.epoch}:${props.visitorId}`,ticket=crypto.randomUUID();
 const result=await db.batch([
  db.prepare("INSERT INTO tool_limits(scope,window,count) VALUES('global',?,0) ON CONFLICT DO NOTHING").bind(day),
  db.prepare('INSERT INTO tool_limits(scope,window,count) VALUES(?,?,0) ON CONFLICT DO NOTHING').bind(scope,minute),
  db.prepare(`UPDATE tool_limits SET count=count+1,ticket=? WHERE scope='global' AND window=? AND count<${TOOL_DAY_LIMIT} AND (SELECT count FROM tool_limits WHERE scope=? AND window=?)<${TOOL_MINUTE_LIMIT} RETURNING count`).bind(ticket,day,scope,minute),
  db.prepare("UPDATE tool_limits SET count=count+1 WHERE scope=? AND window=? AND EXISTS(SELECT 1 FROM tool_limits WHERE scope='global' AND window=? AND ticket=?)").bind(scope,minute,day,ticket),
 ]);
 const allowed=result[2].results.length===1;
 if(!allowed)await securityEvent(db,'RATE_LIMIT',props,now);
 return allowed;
}
export async function pruneLimits(db:D1Database,now=Date.now()){
 await db.batch([
  db.prepare("DELETE FROM tool_limits WHERE (scope='global' AND window<?) OR (scope!='global' AND window<?)").bind(Math.floor(now/TOOL_DAY_MS),Math.floor(now/TOOL_MINUTE_MS)-2),
  db.prepare('DELETE FROM daily_visitors WHERE day<?').bind(Math.floor(now/86400000)),
  db.prepare('DELETE FROM consent_limits WHERE window<?').bind(Math.floor(now/3600000)-23),
  db.prepare('DELETE FROM session_end_tokens WHERE expires_at<=?').bind(now),
 ]);
}
