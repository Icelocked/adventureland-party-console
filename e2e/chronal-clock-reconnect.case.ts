import {test,expect} from './live-fixtures';
import {startNetworkClock} from '../tools/sim/network-clock-broker.mts';
import {createServer,request} from 'node:http';
import {connect,type Socket} from 'node:net';
import {readFileSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {environment} from './fixtures';

test('ChronAL browser clock recovers an initial rejected handshake without losing virtual progress',async({page},info)=>{
 test.skip(process.env.E2E_GAMEPLAY_BACKEND==='native','This regression exercises only the ChronAL transport; native parity uses its native clock.');
 const clock=await startNetworkClock(4),sockets=new Set<Socket>();
 const attempts:Array<{at:number;rejected:boolean}>=[];
 const reads:Array<{at:number;rejected:boolean}>=[];
 let rejectAllReads=false;
 const proxy=createServer((req,res)=>{
  if(new URL(req.url||'/','http://localhost').pathname!=='/observe'){res.end('<html><body>Clock handshake boundary</body></html>');return;}
  const rejected=reads.length===0||rejectAllReads;
  reads.push({at:Date.now(),rejected});
  if(rejected){req.socket.destroy();return;}
  const upstream=request({hostname:'127.0.0.1',port:clock.port,path:req.url},reply=>{res.writeHead(reply.statusCode!);reply.pipe(res);});
  upstream.on('error',()=>res.destroy());req.pipe(upstream);
 });
 proxy.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 proxy.on('upgrade',(req,socket,head)=>{
  attempts.push({at:Date.now(),rejected:attempts.length===0});
  if(attempts.length===1){socket.destroy();return;}
  const upstream=connect(clock.port,'127.0.0.1',()=>{
   const headers=req.rawHeaders.reduce((s,value,index)=>s+value+(index%2?'\r\n':': '),'');
   upstream.write(`GET ${req.url} HTTP/1.1\r\n${headers}\r\n`);
   if(head.length)upstream.write(head);socket.pipe(upstream).pipe(socket);
  });
  sockets.add(upstream);upstream.on('close',()=>{sockets.delete(upstream);socket.destroy();});
  upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());
 });
 await new Promise<void>(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 const address=proxy.address();if(!address||typeof address==='string')throw Error('Clock proxy unavailable');
 const origin=`http://127.0.0.1:${address.port}`;
 try{
  const config={rate:4,epoch:clock.epoch,wall:clock.epoch,broker:origin,token:clock.token,scope:'initial-clock-handshake'};
  await page.addInitScript({content:`globalThis.__e2eClockConfiguration=${JSON.stringify(config)};\n`+readFileSync('.build/sim/browser-clock.js','utf8')});
  await page.goto(origin);
  await page.waitForFunction(()=>(window as any).__e2eChronalClock.state.ticks>=3,undefined,{timeout:10_000});
  const observed=await page.evaluate(()=>{const c=(window as any).__e2eChronalClock;return {now:c.now(),epoch:c.epoch,errors:c.errors,state:c.state};});
  expect(attempts).toHaveLength(2);expect(attempts[0].rejected).toBe(true);expect(attempts[1].rejected).toBe(false);
  expect(observed.errors).toEqual([]);expect(observed.now).toBeGreaterThan(observed.epoch);
  await info.attach('native-clock-handshake-recovery',{body:JSON.stringify({attempts,observed}),contentType:'application/json'});
  const script=`const clock=require(${JSON.stringify(path.resolve('tools/sim/network-clock.cjs'))}).install({dateOnly:true});
    const keepAlive=setInterval(()=>{},1000);const finish=ready=>{clearInterval(keepAlive);console.log(JSON.stringify({ready,now:clock.now(),epoch:clock.epoch,errors:clock.errors,observations:clock.observations}));process.exit(0);};clock.ready.then(()=>finish(true),()=>finish(false));`;
  const observe=()=>promisify(execFile)(process.execPath,['-e',script],{timeout:10_000,windowsHide:true,
    env:environment({E2E_CLOCK_RATE:'4',E2E_CLOCK_WALL_EPOCH:String(clock.epoch),E2E_CLOCK_VIRTUAL_EPOCH:String(clock.epoch),E2E_CLOCK_BROKER:origin,E2E_CLOCK_TOKEN:clock.token,E2E_CLOCK_SCOPE:'observer-reset-regression'})});
  const child=await observe();
  const observer=JSON.parse(child.stdout);
  expect(reads).toHaveLength(2);expect(reads.map(r=>r.rejected)).toEqual([true,false]);
  expect(observer.ready).toBe(true);expect(observer.errors).toEqual([]);expect(observer.observations.requests).toBe(2);
  expect(observer.observations.consecutiveFailures).toBe(0);
  expect(observer.observations.retries).toHaveLength(1);
  expect(observer.observations.retries[0].recoveredAt).toBeGreaterThanOrEqual(observer.observations.retries[0].at);
  expect(observer.now).toBeGreaterThan(observer.epoch);
  await info.attach('native-clock-observer-reset-recovery',{body:JSON.stringify({reads,observer}),contentType:'application/json'});
  rejectAllReads=true;
  const permanent=JSON.parse((await observe()).stdout);
  expect(permanent.ready).toBe(false);expect(permanent.errors).toHaveLength(1);
  expect(permanent.observations.requests).toBe(3);expect(permanent.observations.consecutiveFailures).toBe(3);
  expect(permanent.observations.retries.every((r:{recoveredAt?:number})=>!r.recoveredAt)).toBe(true);
  expect(permanent.now).toBe(permanent.epoch);
  expect(reads.slice(2).map(r=>r.rejected)).toEqual([true,true,true]);
  await info.attach('native-clock-observer-permanent-failure',{body:JSON.stringify({reads:reads.slice(2),observer:permanent}),contentType:'application/json'});
 }finally{await page.close();for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>proxy.close(()=>resolve()));await clock.close();}
});

test('ChronAL late joining actors preserve relative startup timers',async({page},info)=>{
 test.skip(process.env.E2E_GAMEPLAY_BACKEND==='native','ChronAL-only transport initialization regression.');
 const clock=await startNetworkClock(16),server=createServer((_req,res)=>res.end('<html><body>Late clock join</body></html>'));
 const sockets=new Set<Socket>();server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();if(!address||typeof address==='string')throw Error('Late-join HTTP fixture missing');
 const origin=`http://127.0.0.1:${address.port}`,broker=`http://127.0.0.1:${clock.port}`;
 const config={rate:16,epoch:clock.epoch,wall:clock.epoch,broker,token:clock.token,scope:'late-join-witness'};
 const bundle=readFileSync('.build/sim/browser-clock.js','utf8');
 let late:import('@playwright/test').Page|undefined;
 try{
  await page.addInitScript({content:`globalThis.__e2eClockConfiguration=${JSON.stringify(config)};\n`+bundle});
  await page.goto(origin);
  await page.waitForFunction(()=>(window as any).__e2eChronalClock.now()>=(window as any).__e2eChronalClock.epoch+8000,undefined,{timeout:10_000});
  late=await page.context().newPage();
  await late.addInitScript({content:`globalThis.__e2eClockConfiguration=${JSON.stringify({...config,scope:'late-browser'})};\n`+bundle+`
    globalThis.startupTimeouts=[];globalThis.startupIntervals=[];
    setTimeout(()=>startupTimeouts.push(Date.now()),5000);
    const interval=setInterval(()=>{startupIntervals.push(Date.now());if(startupIntervals.length===3)clearInterval(interval);},1000);`});
  await late.goto(origin);
  await late.waitForFunction(()=>(window as any).__e2eChronalClock.state.ticks>=3,undefined,{timeout:10_000});
  const early=await late.evaluate(()=>({now:Date.now(),join:(window as any).__e2eChronalClock.join,timeouts:(window as any).startupTimeouts,intervals:(window as any).startupIntervals}));
  await info.attach('late-browser-initial-observation',{body:JSON.stringify(early),contentType:'application/json'});
  expect(early.timeouts,'A startup deadline must not expire just because the pool is older than its actor').toEqual([]);
  expect(early.join.at).toBeGreaterThanOrEqual(clock.epoch+8000);
  await late.waitForFunction(()=>Date.now()>=(window as any).__e2eChronalClock.join.at+6000,undefined,{timeout:10_000});
  const browser=await late.evaluate(()=>({join:(window as any).__e2eChronalClock.join,timeouts:(window as any).startupTimeouts,intervals:(window as any).startupIntervals,errors:(window as any).__e2eChronalClock.errors}));
  expect(browser.timeouts).toHaveLength(1);expect(browser.intervals).toHaveLength(3);expect(browser.errors).toEqual([]);
  expect(browser.timeouts[0]-browser.join.at).toBeGreaterThanOrEqual(5000);
  browser.intervals.forEach((at:number,index:number)=>expect(at-browser.join.at).toBeGreaterThanOrEqual((index+1)*1000));
  const beforeFork=await page.evaluate(()=>Date.now());
  const script=`const clock=globalThis.__e2eChronalClock,startupAt=Date.now(),timeouts=[],intervals=[];
    setTimeout(()=>timeouts.push(Date.now()),5000);const timer=setInterval(()=>{intervals.push(Date.now());if(intervals.length===3)clearInterval(timer);},1000);
    setTimeout(()=>{console.log(JSON.stringify({startupAt,join:clock.join,timeouts,intervals,errors:clock.errors}));process.exit(0);},6000);`;
  const child=await promisify(execFile)(process.execPath,['--import',pathToFileURL(path.resolve('tools/sim/network-clock-preload.mjs')).href,'-e',script],{timeout:15_000,windowsHide:true,
    env:environment({NODE_OPTIONS:'',E2E_CLOCK_PRELOAD:'1',E2E_CLOCK_RATE:'16',E2E_CLOCK_WALL_EPOCH:String(clock.epoch),E2E_CLOCK_VIRTUAL_EPOCH:String(clock.epoch),E2E_CLOCK_BROKER:broker,E2E_CLOCK_TOKEN:clock.token,E2E_CLOCK_SCOPE:'late-node'})});
  const node=JSON.parse(child.stdout);
  expect(node.startupAt).toBeGreaterThanOrEqual(beforeFork);expect(node.errors).toEqual([]);
  expect(node.timeouts).toHaveLength(1);expect(node.intervals).toHaveLength(3);
  expect(node.timeouts[0]-node.startupAt).toBeGreaterThanOrEqual(5000);
  node.intervals.forEach((at:number,index:number)=>expect(at-node.startupAt).toBeGreaterThanOrEqual((index+1)*1000));
  await info.attach('late-actor-startup-timers',{body:JSON.stringify({beforeFork,browser,node}),contentType:'application/json'});
 }finally{await late?.close();await page.close();for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));await clock.close();}
});
