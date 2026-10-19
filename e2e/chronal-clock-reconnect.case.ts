import {test,expect} from './live-fixtures';
import {startNetworkClock} from '../tools/sim/network-clock-broker.mts';
import {createServer,request} from 'node:http';
import {connect,type Socket} from 'node:net';
import {readFileSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
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
