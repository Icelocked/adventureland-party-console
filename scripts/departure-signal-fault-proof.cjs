const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {departureSignalFaultSource}=require('../e2e/departure-signal-fault.ts');
(async()=>{
 const requests=[];let epoch=1;
 const server=http.createServer((req,res)=>{let body='';req.on('data',part=>body+=part);req.on('end',()=>{
  requests.push({url:req.url,method:req.method,body});if(req.url==='/document'){res.end('<!doctype html><body>Native departure XHR proof</body>');return;}
  const u=new URL(req.url,'http://localhost'),chosen=Number(u.searchParams.get('epoch'))||epoch++;
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({convoySignal:{phase:u.searchParams.has('wrong')?'walking':'scheduled',epoch:chosen,departAt:Date.now()+17+(u.searchParams.has('stale')?-1000:350)}}));
 });});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/document');
  await page.addScriptTag({path:path.resolve(__dirname,'../.caracal/node_modules/jquery/dist/jquery.js')});
  await page.evaluate(()=>{globalThis.sharedRoutine={queueClockOffset:()=>17};globalThis.__otherCompletions=0;$(document).on('ajaxComplete.otherProof',()=>__otherCompletions++);});
  const installed=await page.evaluate(departureSignalFaultSource('W'));
  await page.evaluate(async()=>{
   const request=(url,name='W')=>new Promise((resolve,reject)=>$.ajax({url,method:'POST',contentType:'application/json',data:JSON.stringify({name}),dataType:'json',success:resolve,error:reject}));
   await request('/party-api/status?wrong=1');await request('/party-api/status?stale=1');await request('/other');await request('/party-api/status','P');
   for(const epoch of [101,101,102,103,104]){await request('/party-api/status?epoch='+epoch);await new Promise(resolve=>setTimeout(resolve,10));}
   __e2eDepartureHook.enabled=false;$(document).off('.e2eDepartureFault');await request('/party-api/status?epoch=105');
  });
  const result=await page.evaluate(()=>({hook:__e2eDepartureHook,blocked:__e2eDepartureFaults,otherCompletions:__otherCompletions}));
  if(result.hook.signals.length!==3||result.blocked.length!==3||result.blocked.some(f=>f.startedAt>f.deadline||f.endedAt<f.deadline+1500)||result.otherCompletions!==10||result.hook.signals.some(f=>f.method!=='POST'||f.character!=='W'||f.clockOffset!==17))throw Error(JSON.stringify(result));
  fs.mkdirSync(path.resolve(__dirname,'../.build'),{recursive:true});fs.writeFileSync(path.resolve(__dirname,'../.build/departure-signal-fault-proof.json'),JSON.stringify({installed,result,requests},null,2));console.log(JSON.stringify(result));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
