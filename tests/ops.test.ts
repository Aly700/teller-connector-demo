import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
// Configuration checks never load a job, open a tunnel or deploy a Worker.
test('the named tunnel forwards only the signed origin and ends with a 404',()=>{
 const config=readFileSync('ops/tunnel.yml','utf8');
 assert.deepEqual([...config.matchAll(/^\s*(?:- )?service: (.+)$/gm)].map(v=>v[1]),['http://127.0.0.1:18081','http_status:404']);
 assert.deepEqual([...config.matchAll(/^\s*- hostname: (.+)$/gm)].map(v=>v[1]),['origin.demo.example.invalid']);
 assert.match(config,/^tunnel: [a-f0-9-]{36}$/m);
});
test('all services run at boot, retry failures, and reset follows 03:00 system time',()=>{
 const files=readdirSync('ops/launchd');assert.equal(files.length,5);
 for(const file of files){const xml=readFileSync('ops/launchd/'+file,'utf8');assert.match(xml,/<key>RunAtLoad<\/key>\s*<true\/>/);assert.match(xml,/<key>SuccessfulExit<\/key>\s*<false\/>/);}
 const reset=readFileSync('ops/launchd/local.tcd.reset.plist','utf8');assert.match(reset,/<key>Hour<\/key>\s*<integer>3<\/integer>/);assert.match(reset,/<key>Minute<\/key>\s*<integer>0<\/integer>/);
});
test('production configuration uses placeholders, separates auth, and retains minute expiry delivery',()=>{
 const load=(p:string)=>JSON.parse(readFileSync(p,'utf8').replace(/^\/\/.*\n/,''));
 const m=load('wrangler.jsonc'),a=load('apps/auth/wrangler.jsonc');
 assert.ok(!JSON.stringify([m,a]).includes('account_id'));assert.deepEqual(m.env.production.triggers.crons,['* * * * *']);
 assert.equal(m.env.production.services[0].service,a.env.production.name);assert.equal(a.env.production.vars.PUBLIC_ORIGIN,m.env.production.vars.PUBLIC_ORIGIN);
 assert.equal(m.env.production.vars.ORIGIN_URL,'https://origin.demo.example.invalid');
});
