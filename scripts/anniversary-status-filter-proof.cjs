const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {anniversaryStatusFaultSource}=require('../e2e/anniversary-status-fault.ts');
(async()=>{
 const requests=[];
 const server=http.createServer((req,res)=>{requests.push(req.url);
  if(req.url==='/document'){res.end('<!doctype html><body>Native jQuery read-boundary proof</body>');return;}
  if(req.url.includes('error')){res.statusCode=503;res.end('{"error":"native failure"}');return;}
  res.setHeader('Content-Type','application/json');res.end(req.url.includes('invalid')?'not-json':JSON.stringify({untouched:17,anniversary:{live:false}}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/document');
  await page.addScriptTag({path:path.resolve(__dirname,'../.caracal/node_modules/jquery/dist/jquery.js')});
  await page.evaluate(()=>{globalThis.__previous=[];$.ajaxPrefilter('json',options=>{options.dataFilter=function(raw,type){__previous.push({sameThis:this.url===options.url,type});if(raw==='not-json')return raw;const value=JSON.parse(raw);value.previous=true;return JSON.stringify(value);};});});
  const installed=await page.evaluate(anniversaryStatusFaultSource('W','M'));
  const result=await page.evaluate(async()=>{
   const request=(url,body)=>new Promise(resolve=>$.ajax({url,method:body?'POST':'GET',contentType:'application/json',data:body?JSON.stringify(body):undefined,dataType:'json',success:(data,status,xhr)=>resolve({data,status:httpStatus(xhr)}),error:(xhr,status)=>resolve({status:httpStatus(xhr),error:status})}));
   function httpStatus(xhr){return xhr.status;}
   const full=await request('/party-api/status'),fast=await request('/party-api/status?fast=1'),other=await request('/other');
   const combatOnly=await request('/party-api/status',{combatOnly:true}),combatWait=await request('/party-api/status',{combatWait:true});
   const invalid=await request('/party-api/status?invalid=1'),error=await request('/party-api/status?error=1');
   const count=__e2eAnniversaryStatusFault.count;__e2eAnniversaryStatusFault.enabled=false;
   const disabled=await request('/party-api/status');return {full,fast,combatOnly,combatWait,other,invalid,error,disabled,count,finalCount:__e2eAnniversaryStatusFault.count,previous:__previous};
  });
  if(result.full.data.anniversary.handoffTargets[0].round!=='historical-earlier-round'||result.full.data.untouched!==17||!result.full.data.previous||result.full.status!==200||result.count!==1||result.finalCount!==1||[result.fast,result.combatOnly,result.combatWait,result.other,result.disabled].some(value=>value.data.anniversary.handoffTargets)||result.invalid.error!=='parsererror'||result.error.status!==503||result.previous.some(call=>!call.sameThis||call.type!=='json'))throw Error(JSON.stringify(result));
  fs.mkdirSync(path.resolve(__dirname,'../.build'),{recursive:true});fs.writeFileSync(path.resolve(__dirname,'../.build/anniversary-status-filter-proof.json'),JSON.stringify({installed,result,requests},null,2));console.log(JSON.stringify({installed,count:result.count,httpFailure:result.error,invalid:result.invalid,previousCalls:result.previous.length}));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
