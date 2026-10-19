import {test,expect} from './live-fixtures';
import {startNetworkClock} from '../tools/sim/network-clock-broker.mts';
import {createServer} from 'node:http';
import {connect,type Socket} from 'node:net';
import {readFileSync} from 'node:fs';

test('ChronAL browser clock recovers an initial rejected handshake without losing virtual progress',async({page},info)=>{
 test.skip(process.env.E2E_GAMEPLAY_BACKEND==='native','This regression exercises only the ChronAL transport; native parity uses its native clock.');
 const clock=await startNetworkClock(4),sockets=new Set<Socket>();
 const attempts:Array<{at:number;rejected:boolean}>=[];
 const proxy=createServer((_req,res)=>res.end('<html><body>Clock handshake boundary</body></html>'));
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
 }finally{await page.close();for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>proxy.close(()=>resolve()));await clock.close();}
});
