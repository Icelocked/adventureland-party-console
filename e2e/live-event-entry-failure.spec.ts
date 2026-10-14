import {test,expect} from './live-fixtures';
import type {Route} from '@playwright/test';

const W='E2EWarrior', P='E2EPriest', names=[W,P];
test.use({initialPosition:{map:'halloween',x:-550,y:-290}});

for(const fault of ['Town unavailable once','entry unavailable until exhausted'] as const){
test(`native event entry recovers ${fault}`,async({live},info)=>{
  test.setTimeout(360_000);
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  const seed=await live.admin(`output=(()=>{const original=G.monsters.mrpumpkin;
    globalThis.__entryRecoveryOriginalPumpkin=original;
    G.monsters.mrpumpkin={...original,hp:100000000,attack:1,speed:0,charge:0,range:1,aggro:0,peaceful:true,spawns:[]};
    const m=new_monster('halloween',{type:'mrpumpkin',count:1,boundary:[-495,685,-495,685]},{temp:1});
    E.mrpumpkin={live:true,id:String(m.id),map:m.map,x:m.x,y:m.y,hp:m.hp,max_hp:m.max_hp};broadcast_e();
    return {id:String(m.id),map:m.map,x:m.x,y:m.y};
  })()`);
  const context=live.clients[W].page.context(), requests:any[]=[], samples:any[]=[];
  let refusals=0;
  const rejectEntry=async(route:Route)=>{
    const req=route.request(),body=req.method()==='POST'?req.postDataJSON():null;
    if(body?.character!==W)return route.fallback();
    const s=await live.state(),c=s.activeConvoy;
    if(c?.walkingActivity!=='event'||c.walkingEvent!=='mrpumpkin')return route.fallback();
    const movement=await live.clients[W].run('globalThis.__partyMovement?.report?.()');
    if(movement?.id!==body.id)return route.fallback();
    const rejected=fault==='entry unavailable until exhausted'||refusals===0;
    requests.push({at:Date.now(),body,convoy:c.id,revision:c.walkingParents?.[W]?.revision,
      recoveryAttempts:c.recoveryAttempts,disableTown:c.disableTown,rejected});
    if(!rejected)return route.fallback();
    refusals++;
    // Declared failure at the planner HTTP boundary. All recovery movement,
    // attendance, native arrival and attack receipts remain production behavior.
    await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:
      fault==='Town unavailable once'?'Town warp currently unavailable':'Declared entry service unavailable'})});
  };
  await context.route('**/party-api/movement-plan',rejectEntry);
  try{
    await live.post('/formation',{character:W,eventSelections:['mrpumpkin']});
    if(fault==='Town unavailable once'){
      await expect.poll(async()=>{
        const hits=await live.clients[W].events();
        return names.every(name=>hits.some((e:any)=>e.event==='hit'&&String(e.data?.id)===seed.id&&e.data?.hid===name&&e.data?.damage>0));
      },{timeout:180_000,message:'Walking fallback must reach the actual boss and both fighters must deal native damage'}).toBe(true);
      expect(refusals).toBe(1);
      expect(requests.some(r=>!r.rejected&&r.disableTown&&r.body.town===false)).toBe(true);
    }else{
      await expect.poll(async()=>{
        const s=await live.state();samples.push({at:Date.now(),convoy:s.activeConvoy,eventReturn:s.eventReturn,
          attendance:s.eventAttendance,characters:Object.fromEntries(names.map(n=>[n,{map:s.characters[n]?.map,x:s.characters[n]?.x,y:s.characters[n]?.y,eventRecovery:s.characters[n]?.eventRecovery}]))});
        if(samples.length>80)samples.splice(1,1);
        return names.every(n=>s.eventAttendance[n]?.mrpumpkin?.ignored==='travel failure');
      },{timeout:90_000,message:'Exhausted entry must skip this occurrence and begin owned recovery'}).toBe(true);
      expect(refusals).toBe(3);
      await expect.poll(async()=>{const s=await live.state();return !s.eventReturn&&!s.activeConvoy&&names.every(n=>
        s.characters[n]?.map==='main'&&!s.characters[n]?.rip&&Math.hypot(s.characters[n].x,s.characters[n].y)<150);
      },{timeout:150_000,message:'Both real native characters must recover to Main after exhausted entry'}).toBe(true);
      const before=refusals;await live.restartCoordinator();
      await expect.poll(async()=>{const s=await live.state();return names.every(n=>s.characters[n]?.map==='main'&&
        Date.now()-s.characters[n].seenAt<3000&&s.eventAttendance[n]?.mrpumpkin?.ignored==='travel failure');
      },{timeout:30_000}).toBe(true);
      expect(refusals).toBe(before);
    }
  }finally{
    await context.unroute('**/party-api/movement-plan',rejectEntry);
    await info.attach('native-event-entry-recovery',{body:JSON.stringify({fault,seed,requests,samples,final:await live.state(),events:await live.clients[W].events()}),contentType:'application/json'});
    await live.post('/formation',{character:W,eventSelections:[]});
    await live.admin(`output=(()=>{const m=get_monster('mrpumpkin');if(String(m?.id)===${JSON.stringify(seed.id)})remove_monster(m,{silent:true});G.monsters.mrpumpkin=globalThis.__entryRecoveryOriginalPumpkin;delete globalThis.__entryRecoveryOriginalPumpkin;delete E.mrpumpkin;broadcast_e();return true;})()`);
  }
});
}
