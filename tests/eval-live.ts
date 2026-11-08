import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCases,runEval } from '../eval/run.ts';
import { fixtureRuntime } from '../eval/runtime.ts';
import { StubProvider } from './stub-provider.ts';
import { base } from './helpers.ts';
test('stub selections exercise all 80 fixtures with production handlers and real Teller, without publication',async()=>{
 const r=await runEval(loadCases(),new StubProvider(),fixtureRuntime(true),{revision:'0'.repeat(40),trigger:'manual'});
 assert.equal(r.kind,'stub');assert.equal(r.results.length,80);
 assert.deepEqual(r.results.filter(v=>!v.pass),[]);
 console.log('PASS 80 test-only selections, real Teller fixture assertions, zero model calls. No score published.');
});
test('public report and download stay unscored after stub tests and reject unauthorized publishers',async()=>{
 const page=await fetch(base+'/eval');assert.equal(page.status,200);assert.match(await page.text(),/Not run yet/);
 const data=await (await fetch(base+'/eval.json')).json() as any;assert.deepEqual(data.runs,[]);
 assert.equal((await fetch(base+'/internal/eval/reserve',{method:'POST',body:'{}'})).status,401);
});
