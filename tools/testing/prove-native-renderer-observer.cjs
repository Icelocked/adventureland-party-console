const http=require('http'),fs=require('fs'),path=require('path');
const {pathToFileURL}=require('url');
const {chromium}=require('playwright');
(async()=>{
  const server=http.createServer((req,res)=>{
    if(req.url==='/index'){res.end('<!doctype html><title>Isolated renderer diagnostic</title>');return;}
    setTimeout(()=>{res.setHeader('Content-Type','application/json');res.end('{}');},50);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch();
  try{
    const page=await browser.newPage();
    const {observeNativeTransport}=await import(pathToFileURL(path.resolve(__dirname,'../../e2e/native-transport-observer.ts')));
    const observer=await observeNativeTransport(page);await page.goto(base+'/index');
    await page.evaluate(async base=>{
      // This blank diagnostic document has no game. The name only scopes metadata.
      window.character={name:'E2EWarrior'};
      const response=fetch(base+'/party-api/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'E2EWarrior',combatOnly:true,travelSample:{sequence:1}})});
      await new Promise(resolve=>setTimeout(resolve,20));
      function rendererProofBusy(duration){const start=performance.now();while(performance.now()-start<duration){}}
      rendererProofBusy(1000);await response.then(response=>response.text());
      const timer=setInterval(()=>rendererProofBusy(100),150);setTimeout(()=>clearInterval(timer),11000);
    },base);
    await new Promise(resolve=>setTimeout(resolve,12000));
    await page.goto(base+'/index'); // Node longtask/profile evidence survives retirement.
    const result=await observer.finish();
    if(!result.renderer.trigger||result.renderer.trigger.notificationLagMs<500||!result.renderer.profile?.samples?.length||!result.renderer.longTasks.some(task=>task.duration>=800))throw Error('Actual renderer/profile observation failed');
    if(!result.renderer.profile.nodes.some(node=>node.callFrame.functionName==='rendererProofBusy'))throw Error('Actual CPU workload missing');
    if(result.renderer.profile.nodes.some(node=>node.callFrame.url.includes('?')))throw Error('Profile query was retained');
    fs.mkdirSync('.build',{recursive:true});fs.writeFileSync('.build/native-renderer-observer-proof.json',JSON.stringify(result,null,2));
    console.log(JSON.stringify({lagMs:result.renderer.trigger.notificationLagMs,longTasks:result.renderer.longTasks.length,profileSamples:result.renderer.profile.samples.length,errors:result.renderer.errors}));
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
