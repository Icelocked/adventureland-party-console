import {test,expect} from './fixtures';

test('metrics persists deduplicated native observations across coordinator restart',async({app,page},info)=>{
  const at=Math.floor(Date.now()/10000)*10000;
  const sample={at:at+100,gold:100,luck:100,ping:30,level:1,xp:0,maxXp:100};
  const frame={at,sequence:1,observedMs:1000,partial:false,damage:[{monster:'goo',skill:'attack',amount:23,hits:1}],credits:[],kills:[{id:'metrics-native-death',at:at+100,monster:'goo',actor:'W'}],loot:[],first:sample,last:sample};
  const batch={character:'W',server:'US I',runtime:'metrics-e2e',frames:[frame]};
  for(let n=0;n<2;n++){const response=await page.request.post(app.url+'/party-api/metrics',{data:batch});expect(response.ok()).toBeTruthy();}
  await app.restartCoordinator();
  expect((await page.request.post(app.url+'/party-api/metrics',{data:batch})).ok()).toBeTruthy();
  const response=await page.request.get(app.url+'/party-api/metrics?from='+at+'&to='+(at+20000));
  expect(response.ok()).toBeTruthy();const history=await response.json();
  const points=history.points;expect(points.flatMap((p:any)=>p.kills).reduce((n:number,k:any)=>n+k.count,0)).toBe(1);
  expect(points.flatMap((p:any)=>p.values).flatMap((v:any)=>v.damage).reduce((n:number,d:any)=>n+d.amount,0)).toBe(23);
  await info.attach('metrics-restart-deduplication',{body:JSON.stringify(history),contentType:'application/json'});
});
