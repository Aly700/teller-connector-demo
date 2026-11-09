// Real ledger writes run after the live-seed baseline checks in the serial test suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { base,session,mcp } from './helpers.ts';
import { chromium } from '../scripts/browser.ts';
const call=async(s:any,name:string,args:object)=>(await (await mcp(s.tokens.access_token,'tools/call',{name,arguments:args})).json() as any).result.structuredContent;
test('console has local assets, live queue, keyboard confirmation, both themes and responsive pages',async()=>{
 const s=await session(),other=await session(),list=await call(s,'list_accounts',{});
 const browser=await chromium.launch();
 try{
  const context=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'dark',timezoneId:'America/Toronto'});
  await context.addCookies([{name:'__Host-sample-session',value:/__Host-sample-session=([^;]+)/.exec(s.cookie)![1],domain:'localhost',path:'/',secure:true,httpOnly:true,sameSite:'Lax'}]);
  const page=await context.newPage();const errors:string[]=[],external:string[]=[];
  page.on('pageerror',(error:Error)=>errors.push(String(error)));page.on('request',(req:any)=>{if(new URL(req.url()).origin!==base)external.push(req.url());});
  await page.goto(base+'/queue');await page.evaluate(()=>{(window as any).sameDocument=true;});
  await page.getByRole('button',{name:'All requests',exact:true}).focus();
  const held=await call(s,'request_transfer',{fromAccount:'operating',toAccount:'reserve',amountMinor:125,currency:'CAD',requestKey:list.requestSlots[0].requestKey});
  await page.getByText('New activity · waiting for focus to move',{exact:true}).waitFor({timeout:22000});
  assert.equal(await page.getByRole('link',{name:held.reference,exact:true}).count(),0);
  await page.getByRole('link',{name:'Accounts',exact:true}).focus();
  await page.getByRole('link',{name:held.reference,exact:true}).waitFor({timeout:5000});
  assert.equal(await page.evaluate(()=>(window as any).sameDocument),true);
  await page.getByRole('link',{name:held.reference,exact:true}).click();
  const before=JSON.parse(await readFile('.data/origin-metrics.json','utf8')).transferPosts;
  assert.equal(await page.getByRole('button',{name:'Approve transfer',exact:true}).isVisible(),false);
  await page.locator('.approval-review summary').focus();await page.keyboard.press('Enter');
  assert.equal(JSON.parse(await readFile('.data/origin-metrics.json','utf8')).transferPosts,before);
  await page.getByRole('button',{name:'Approve transfer',exact:true}).focus();await page.keyboard.press('Enter');
  await page.getByRole('heading',{name:'Posted in Teller',exact:true}).waitFor();
  assert.equal(JSON.parse(await readFile('.data/origin-metrics.json','utf8')).transferPosts,before+1);
  assert.ok(await page.getByText(/Ledger reference:/).isVisible());
  const time=page.locator('[data-local-time]').first();assert.match(await time.innerText(),/EST/);assert.match(await time.getAttribute('title'),/Z$/);
  const rejected=await call(s,'request_transfer',{fromAccount:'operating',toAccount:'reserve',amountMinor:200,currency:'CAD',requestKey:list.requestSlots[1].requestKey});
  await page.goto(rejected.approvalUrl);
  const reject=page.getByRole('button',{name:'Reject request',exact:true});await reject.focus();
  assert.equal(await reject.evaluate((el:HTMLElement)=>getComputedStyle(el).outlineStyle),'solid');
  await page.keyboard.press('Enter');await page.getByRole('heading',{name:'Rejected by you',exact:true}).waitFor();
  assert.equal(JSON.parse(await readFile('.data/origin-metrics.json','utf8')).transferPosts,before+1);
  assert.ok(await page.getByText('Teller has received nothing',{exact:true}).isVisible());
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await page.getByRole('button',{name:'Copy idempotency key',exact:true}).click();
  await page.getByRole('button',{name:'Copied to clipboard',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),list.requestSlots[1].requestKey);
  for(const path of ['/accounts','/audit','/queue/snapshot'])assert.equal((await fetch(base+path,{headers:{Authorization:'Bearer '+s.tokens.access_token}})).status,401);
  const accountText=await (await fetch(base+'/accounts',{headers:{Cookie:s.cookie}})).text();
  assert.ok(accountText.includes(list.accounts[0].id));
  assert.ok(!(await (await fetch(base+'/accounts',{headers:{Cookie:other.cookie}})).text()).includes(list.accounts[0].id));
  for(const theme of ['dark','light']){
   await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
   for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:720,height:450}]){
    await page.setViewportSize(viewport);
    for(const route of ['/queue','/accounts','/audit','/eval','/guide','/session/end',new URL(held.approvalUrl).pathname,'/missing-page']){
     await page.goto(base+route);await page.evaluate(()=>document.fonts.ready);
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${route} ${theme} ${viewport.width}`);
     assert.equal(await page.getByText('Demo data. No real money.',{exact:true}).count(),1);
     assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme),theme);
     assert.equal(await page.evaluate(()=>document.fonts.check('14px Manrope')),true);
    }
   }
  }
  await page.goto(base+'/eval');assert.ok(await page.getByRole('heading',{name:'Not run yet',exact:true}).isVisible());
  const toggle=page.getByRole('button',{name:/Color theme:/});await toggle.focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');await page.reload();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 }finally{await browser.close();}
});

test('server-rendered approval works without JavaScript and preserves the explicit confirmation',async()=>{
 const s=await session(),list=await call(s,'list_accounts',{});
 const held=await call(s,'request_transfer',{fromAccount:'operating',toAccount:'reserve',amountMinor:325,currency:'CAD',requestKey:list.requestSlots[0].requestKey});
 const browser=await chromium.launch();
 try{
  const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844},colorScheme:'light'});
  await context.addCookies([{name:'__Host-sample-session',value:/__Host-sample-session=([^;]+)/.exec(s.cookie)![1],domain:'localhost',path:'/',secure:true,httpOnly:true,sameSite:'Lax'}]);
  const page=await context.newPage();await page.goto(held.approvalUrl);
  const before=JSON.parse(await readFile('.data/origin-metrics.json','utf8')).transferPosts;
  assert.equal(await page.getByRole('button',{name:'Approve transfer',exact:true}).isVisible(),false);
  await page.locator('.approval-review summary').click();
  assert.equal(JSON.parse(await readFile('.data/origin-metrics.json','utf8')).transferPosts,before);
  await page.getByRole('button',{name:'Approve transfer',exact:true}).click();
  await page.getByRole('heading',{name:'Posted in Teller',exact:true}).waitFor();
  assert.equal(JSON.parse(await readFile('.data/origin-metrics.json','utf8')).transferPosts,before+1);
  assert.ok(await page.getByText(/Ledger reference:/).isVisible());
 }finally{await browser.close();}
});
