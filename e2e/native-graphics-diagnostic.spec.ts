import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {installCompanionGraphicsDiagnostic} from './native-graphics-diagnostic';

test('companion rendering experiment rewrites only opted-in native bot requests',async({browser},info)=>{
 const received:string[]=[];
 const server=createServer((req,res)=>{received.push(req.url!);res.setHeader('Content-Type','text/html');res.end('<html><body>Native fixture URL</body></html>');});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();if(!address || typeof address==='string')throw Error('Missing test port');
 const origin=`http://127.0.0.1:${address.port}`;
 const context=await browser.newContext();
 try{
  await installCompanionGraphicsDiagnostic(context,{webUrl:origin,name:'Primary',region:'US',server:'I'},false);
  const page=await context.newPage();
  const companion='/character/Priest/in/US/I/?no_html=true&is_bot=1&code=maincode&existing=keep';
  await page.goto(origin+companion);expect(received.at(-1)).toBe(companion);
  await installCompanionGraphicsDiagnostic(context,{webUrl:origin,name:'Primary',region:'US',server:'I'},true);
  const untouched=['/character/Primary/in/US/I/','/character/Primary/in/US/I/?no_html=true&is_bot=1',
   '/character/Priest/in/US/I/?no_html=false&is_bot=1','/character/Priest/in/US/II/?no_html=true&is_bot=1',
   '/runner.html?no_html=true&is_bot=1','/CODE/adventure_land/shared.js?no_html=true&is_bot=1'];
  for(const path of untouched){await page.goto(origin+path);expect(received.at(-1)).toBe(path);}
  await page.goto(origin+companion);const actual=new URL(received.at(-1)!,origin);
  expect(actual.searchParams.get('no_graphics')).toBe('true');
  expect(actual.searchParams.get('code')).toBe('maincode');expect(actual.searchParams.get('existing')).toBe('keep');
  expect(actual.pathname).toBe('/character/Priest/in/US/I/');
  await page.evaluate(async path=>{await fetch(path,{method:'POST',body:'unchanged'});},companion);
  expect(received.at(-1),'POST must not gain the graphics flag').toBe(companion);
  await page.goto(origin.replace('127.0.0.1','localhost')+companion);
  expect(received.at(-1),'another hostname must remain untouched').toBe(companion);
 }finally{
  await info.attach('native-companion-request-scope',{body:JSON.stringify(received),contentType:'application/json'});
  await context.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 }
});
