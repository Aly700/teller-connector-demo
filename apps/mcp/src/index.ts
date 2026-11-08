import { consumeTool,securityEvent,pruneLimits } from '../../../packages/limits.ts';
import { endSession } from './session.ts';
import { reportPage,evalRoute,retainReports } from '../../../eval/report.ts';
import css from './styles.css';
import { queuePage, detailPage, seededPage, pageError } from './pages.ts';
import { auditExport, recordCall } from './audit.ts';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { resource, type Env } from './auth.ts';
import { bounded, safeHttp, page, escapeHtml } from '../../../packages/http.ts';
import { browserSession, config, type Registry } from '../../../packages/state.ts';
import { readTool, tools, unavailable } from './tools.ts';
import { watchdog } from '../../../packages/gate/dispatch.ts';
import { createHold, heldResult, getHold, expireHold, sweepHolds, type Hold } from '../../../packages/gate/holds.ts';
import { WRITE_TOOL, evaluate } from '../../../packages/gate/policy.ts';
import { holdErrors } from '../../../packages/gate/errors.ts';
import { decisionRoute } from './decisions.ts';
import { failure, success } from './tools.ts';
import { TellerClient } from './teller.ts';
export default { async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (url.origin !== env.PUBLIC_ORIGIN) return safeHttp('INVALID_HOST', 403);
    const origin = request.headers.get('Origin');
    if (origin && origin !== env.PUBLIC_ORIGIN) return safeHttp('INVALID_ORIGIN', 403);
    if (url.pathname.startsWith('/internal/eval/')) {
      if(!['/internal/eval/reserve','/internal/eval/report'].includes(url.pathname))return safeHttp('NOT_FOUND',404);
      if (!await bounded(request, 512*1024)) return safeHttp('TOO_LARGE',413);
      return await evalRoute(request,env.DB,env.EVAL_REPORT_SECRET);
    }
    if(url.pathname==='/eval'&&request.method==='GET')return await reportPage(env.DB);
    if(url.pathname==='/eval.json'&&request.method==='GET')return await reportPage(env.DB,true);
    if (!await bounded(request)) {await securityEvent(env.DB,'TOO_LARGE');return safeHttp('TOO_LARGE', 413);}
    if(url.pathname==='/session/end')return await endSession(request,env.DB,env.PUBLIC_ORIGIN);
    if (url.pathname === '/authorize' || url.pathname.startsWith('/oauth/') || url.pathname === '/.well-known/oauth-authorization-server') return env.AUTH_SERVER.fetch(request);
    if(url.pathname==='/favicon.ico')return new Response(null,{status:204});
    if(url.pathname==='/styles.css')return new Response(css,{headers:{'Content-Type':'text/css; charset=utf-8','Cache-Control':'no-store'}});
    if (url.pathname === '/') return page('<h1>Review a sample transfer</h1><p class="intro">Read sample accounts through your MCP client. Request a transfer, review it here, and decide whether this connector can send it to Teller.</p><p>Connect your client to <code>/mcp</code> and select Start sample session. No email or password is needed.</p><p><a href="/queue">Open your sample queue</a></p><p><a href="/guide">Read the sample guide</a></p>');
    if (url.pathname === '/guide') {
      const visitor = await browserSession(env.DB, request);
      if (!visitor) return page('<h1>Start a sample session from your MCP client</h1>', 401);
      const registry = await env.DB.prepare('SELECT * FROM sample_registry WHERE visitor_id=? AND epoch=?').bind(visitor.id, visitor.epoch).first<Registry>();
      return page(`<h1>Sample guide</h1><p>Accounts: operating, reserve. Transfers: sample-posted, sample-held.</p><p>Use an unused request key with request_sample_transfer. A request waits here until you approve it.</p><ul class="keys">${JSON.parse(registry!.request_slots_json).map((s:any)=>`<li>${escapeHtml(s.reference)}<code>${escapeHtml(s.requestKey)}</code></li>`).join('')}</ul>`);
    }
    if(url.pathname==='/audit/export')return await auditExport(request,env.DB);
    if(url.pathname==='/queue'&&request.method==='GET')return await queuePage(request,env);
    if(/^\/queue\/sample-(held|posted)$/.test(url.pathname)&&request.method==='GET'){
      const visitor=await browserSession(env.DB,request);
      if(visitor&&!await consumeTool(env.DB,{visitorId:visitor.id,epoch:visitor.epoch},'get_sample_transfer'))return pageError('Sample call limit reached','Try again later.',429);
      return await seededPage(request,env,url.pathname.split('/')[2]);
    }
    const queue=/^\/queue\/([a-f0-9-]{36})$/.exec(url.pathname);
    if(queue)return await decisionRoute(request,env,queue[1]);
    if (url.pathname !== '/mcp' && url.pathname !== '/.well-known/oauth-protected-resource/mcp') return safeHttp('NOT_FOUND', 404);
    const response=await resource(env, async (req, props, scopes) => {
      const server = new Server({ name: 'teller-sample', version: '0.1.0' }, { capabilities: { tools: {} } });
      server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
      server.setRequestHandler(CallToolRequestSchema, async call => {
        const started=Date.now();
        try {
          if(!await consumeTool(env.DB,props,call.params.name))return failure('RATE_LIMIT','The sample call limit has been reached. Try again later.');
          if(!tools.some(t=>t.name===call.params.name)){await securityEvent(env.DB,'UNKNOWN_TOOL',props);return failure('UNKNOWN_TOOL','Choose one of the four sample tools.');}
          const settings = await config(env.DB);
          if(evaluate(call.params.name,JSON.parse(settings.tools_json)[call.params.name]===true,true,settings.epoch===props.epoch).effect==='DENY'){const result=unavailable();await recordCall(env.DB,props,call.params.name,null,result,started,undefined,false);return result;}
          const registry = await env.DB.prepare('SELECT * FROM sample_registry WHERE visitor_id=? AND epoch=?').bind(props.visitorId, props.epoch).first<Registry>();
          if (!registry) return unavailable();
          if(call.params.name===WRITE_TOOL){
            if(!scopes.includes('sample:request')){const result=failure('INSUFFICIENT_SCOPE','Reconnect with sample:request to request a held transfer.');await recordCall(env.DB,props,call.params.name,null,result,started);return result;}
            try {return success(heldResult(await createHold(env.DB,props,call.params.arguments),env.PUBLIC_ORIGIN));}
            catch(error){const code=error instanceof Error && holdErrors[error.message]?error.message:'HOLD_UNCONFIRMED';const result=failure(code,holdErrors[code]);try{await recordCall(env.DB,props,call.params.name,null,result,started);}catch{}return result;}
          }
          const holds=await env.DB.prepare('SELECT * FROM holds WHERE visitor_id=? AND epoch=?').bind(props.visitorId,props.epoch).all<Hold>();
          registry.request_slots_json=JSON.stringify(JSON.parse(registry.request_slots_json).map((slot:any)=>({...slot,used:holds.results.some(h=>h.request_key===slot.requestKey)})));
          for(let i=0;i<holds.results.length;i++)holds.results[i]=await expireHold(env.DB,holds.results[i]);
          const result = await readTool(call.params.name, call.params.arguments, registry, new TellerClient(env.ORIGIN_URL, env.ORIGIN_SIGNING_SECRET, props.epoch), holds.results, env.PUBLIC_ORIGIN);
          await recordCall(env.DB,props,call.params.name,call.params.arguments,result,started,holds.results.find(h=>h.reference===call.params.arguments?.reference));
          return result;
        } catch { return unavailable(); }
      });
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      return transport.handleRequest(req);
    }).fetch(request, env, ctx);
    if(response.status===401||response.status===403)await securityEvent(env.DB,'AUTH_FAILURE');
    return response;
  } catch { return new URL(request.url).pathname.startsWith('/mcp')?safeHttp('DEMO_UNAVAILABLE',503):pageError('Sample unavailable','The demo is unavailable. Try again later.',503); }
}, async scheduled(_event:ScheduledController,env:Env,ctx:ExecutionContext){ctx.waitUntil(Promise.all([sweepHolds(env.DB),watchdog(env.DB),retainReports(env.DB),pruneLimits(env.DB)]));} };
