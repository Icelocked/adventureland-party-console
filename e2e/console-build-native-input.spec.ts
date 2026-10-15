import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {gateNativeAjaxInput} from './native-ajax-input';

for(const outcome of ['success','http-failure','input-failure','ownership-lost','abort-before','abort-after'] as const)
test(`native checkpoint input preserves real HTTP ${outcome}`,async({page},info)=>{
  // Failure inventory: docs/testing-native-lucky-input-gate.md, written before implementation.
  const requests:any[]=[];
  const jquery=readFileSync(path.resolve('.caracal/node_modules/jquery/dist/jquery.js'));
  const server=createServer((request,response)=>{
    if(request.url==='/jquery'){response.end(jquery);return;}
    if(request.url==='/'){response.end('<script src="/jquery"></script>');return;}
    let body='';request.on('data',chunk=>body+=chunk);request.on('end',()=>{
      requests.push({url:request.url,body});
      if(outcome==='abort-after'){response.on('close',()=>{});return;}
      response.writeHead(outcome==='http-failure'?503:200,{'content-type':'application/json'});
      response.end(JSON.stringify({id:'actual-checkpoint',body}));
    });
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('Loopback server unavailable');
  try{
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.evaluate(source=>{
      const host=window as any;
      host.input=new Promise<void>((resolve,reject)=>{host.release=resolve;host.rejectInput=reject;});
      host.owner=true;host.original=host.$.ajax;
      (0,eval)(`(${source})(window,options=>options?.url==='/checkpoint',()=>window.input,()=>window.owner)`);
      host.call=host.$.ajax({url:'/checkpoint',method:'POST',data:'{"id":"actual-checkpoint","journal":{"phase":"restoring"}}',dataType:'json'});
      host.call.done((value:any)=>host.result={ok:true,value}).fail((xhr:any,status:string,error:any)=>host.result={ok:false,status,error:String(error),httpStatus:xhr?.status});
    },gateNativeAjaxInput.toString());
    expect(requests).toHaveLength(0);
    if(outcome==='abort-before')await page.evaluate(()=>{(window as any).call.abort();});
    else if(outcome==='input-failure')await page.evaluate(()=>(window as any).rejectInput(Error('Missing Priest CODE')));
    else {
      await page.evaluate(lost=>{const host=window as any;if(lost)host.owner=false;host.release();},outcome==='ownership-lost');
      if(outcome==='abort-after'){
        await expect.poll(()=>requests.length).toBe(1);
        await page.evaluate(()=>{(window as any).call.abort();});
      }
    }
    await expect.poll(()=>page.evaluate(()=>(window as any).result)).toBeTruthy();
    const result=await page.evaluate(()=>(window as any).result);
    expect(result.ok).toBe(outcome==='success');
    if(['success','http-failure','abort-after'].includes(outcome)){
      expect(requests).toHaveLength(1);
      expect(JSON.parse(requests[0].body)).toEqual({id:'actual-checkpoint',journal:{phase:'restoring'}});
    }else expect(requests).toHaveLength(0);
    if(outcome==='http-failure')expect(result.httpStatus).toBe(503);
    if(outcome.startsWith('abort'))expect(result.status).toBe('abort');
    if(outcome==='input-failure')expect(result.error).toContain('Missing Priest CODE');
    if(outcome==='ownership-lost')expect(result.error).toContain('ownership');
    await info.attach('native-input-http-ledger',{body:JSON.stringify({outcome,requests,result}),contentType:'application/json'});
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('native checkpoint input leaves unmatched AJAX calls identical',async({page},info)=>{
  await page.setContent('<html></html>');
  const result=await page.evaluate(source=>{
    const host=window as any,receiver={marker:'receiver'},options={url:'/ordinary',data:'unchanged'},returned={marker:'original-result'};
    let actual:any;
    host.$={ajax:function(...args:any[]){actual={receiver:this,args};return returned;}};
    (0,eval)(`(${source})(window,options=>options?.url==='/checkpoint',()=>Promise.reject(Error('must not run')),()=>true)`);
    const value=host.$.ajax.call(receiver,options);
    return {sameResult:value===returned,sameReceiver:actual.receiver===receiver,sameOptions:actual.args[0]===options,arguments:actual.args.length};
  },gateNativeAjaxInput.toString());
  expect(result).toEqual({sameResult:true,sameReceiver:true,sameOptions:true,arguments:1});
  await info.attach('unmatched-native-input',{body:JSON.stringify(result),contentType:'application/json'});
});
