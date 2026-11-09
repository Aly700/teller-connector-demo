import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { originFetch } from './handler.ts';
import { SAMPLE } from '../packages/sample.ts';
if(!process.env.ORIGIN_SIGNING_SECRET||!process.env.TELLER_API_KEY)throw new Error('Local origin credentials required');
let closing=false;
const metrics={transferPosts:0,byKey:{} as Record<string,number>};
let metricsWrite=Promise.resolve();
await writeFile('.data/origin-metrics.json',JSON.stringify(metrics),{mode:0o600});
const server=createServer(async(req,res)=>{
  try{
    if(closing||!['GET','POST'].includes(req.method??'')){res.writeHead(503);res.end();return;}
    const chunks:Buffer[]=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>16384){res.writeHead(413);res.end();return;}chunks.push(chunk);}
    const pool=JSON.parse(await readFile('.data/pool.json','utf8')),state=JSON.parse(await readFile('.data/origin-state.json','utf8'));
    const response=await originFetch(new Request('http://127.0.0.1:18081'+req.url,{method:req.method,headers:req.headers as Record<string,string>,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})}),{
      pool,maintenance:state.maintenance!==false,writesEnabled:state.writesEnabled===true,secret:process.env.ORIGIN_SIGNING_SECRET!,apiKey:process.env.TELLER_API_KEY!,
      upstream:async request=>{if(request.method==='POST'){metrics.transferPosts++;const key=request.headers.get('Idempotency-Key')!;metrics.byKey[key]=(metrics.byKey[key]??0)+1;const snapshot=JSON.stringify(metrics);metricsWrite=metricsWrite.then(()=>writeFile('.data/origin-metrics.json',snapshot,{mode:0o600}));await metricsWrite;}return fetch(request);},
      beforeSend:async()=>{const current=JSON.parse(await readFile('.data/origin-state.json','utf8'));return !closing&&current.maintenance===false&&current.writesEnabled===true&&current.epoch===pool.epoch;},
    });res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
  }catch{res.writeHead(503);res.end(JSON.stringify({...SAMPLE,code:'ORIGIN_UNAVAILABLE'}));}
});
server.listen(18081,'127.0.0.1',async()=>{await writeFile('.data/origin.pid',String(process.pid),{mode:0o600});console.log('Signed sample origin listening on 127.0.0.1:18081. Demo data. No real money.');});
for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,()=>{closing=true;server.close(()=>process.exit(0));});
