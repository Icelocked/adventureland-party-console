import {test,expect} from './live-fixtures';
import {waitForGameplay} from './network-clock';
import {W,P} from './hunt-interruption-helpers';
import {contains} from '../dashboard/lib/farming-zones';
import {farmingAreas} from '../dashboard/lib/farming-areas';

// The live farm from 2026-10-25 00:21-00:28 UTC: 4 deaths in 7 minutes on uhills
// targetrons with a designated tank, while Ryan's base farms them without one. This
// spec farms the native uhills spawns (targetron and sparkbot at their game density)
// for FARM_MS and records deaths and the peak count of monsters targeting the party.
// E2E_TANK picks the designated tank: warrior, priest, or unset. Ryan's base has no
// tank field, so it ignores the formation request's tank. E2E_LOADOUT=fragile farms
// with live-like HP (the live priest had 8522 max HP) instead of combat-range armor.
const B='E2EBankBoi',fighters=[W,P,B],FARM_MS=300000;
const tank=({warrior:W,priest:P} as Record<string,string>)[process.env.E2E_TANK||'']||null;
test.use({loadout:(process.env.E2E_LOADOUT||'combat-range') as 'combat-range',extraFighter:'mage',initialPosition:{map:'uhills',x:-225,y:-207}});

test(`uhills targetron farm with tank ${tank||'unset'}`,async({live},info)=>{
  test.setTimeout(FARM_MS+180000);
  await live.post('/merchant/force-stand',{enabled:true});
  await live.post('/formation',tank?{leader:W,tank}:{leader:W});
  for(const name of [P,B])await live.post('/formation',{character:name,follow:true});
  await live.post('/farming-mode',{character:W,mode:'default'});
  // The live party farmed the targetron area at uhills (-544,-257).
  const area=farmingAreas((await live.state(true)).monsterChoices,['targetron'])
    .find(candidate=>candidate.map==='uhills'&&contains(candidate,{map:'uhills',x:-544,y:-257},0,1));
  expect(area,'Native catalog must contain the live Targetron farm').toBeTruthy();
  await live.post('/navigate-to-monster',{monsterId:'targetron',location:area});
  await live.post('/focus',{monsterFocus:['targetron'],monsterPriorities:{},monsterSearchRadius:500});
  const samples:any[]=[],deaths:any[]=[],wasDead:Record<string,boolean>={};
  let peak=0,minHp=1;
  try{
    const end=Date.now()+FARM_MS;
    while(Date.now()<end){
      const world=await live.admin(`output=(()=>{const names=${JSON.stringify(fighters)};
        const ps=names.map(n=>get_player(n)).filter(Boolean);
        const ms=Object.values(instances.uhills.monsters).filter(m=>!m.dead&&names.includes(m.target));
        return {players:ps.map(p=>({name:p.name,map:p.map,x:Math.round(p.x),y:Math.round(p.y),hp:p.hp,max_hp:p.max_hp,rip:!!p.rip})),
          attackers:ms.map(m=>({id:String(m.id),mtype:m.type,target:m.target})),
          nearby:Object.values(instances.uhills.monsters).filter(m=>!m.dead).length};})()`);
      const tankMode=tank?await live.clients[tank].run('(globalThis.partyCombatPosition||{}).mode||null').catch(()=>null):null;
      peak=Math.max(peak,world.attackers.length);
      for(const p of world.players)if(!p.rip)minHp=Math.min(minHp,p.hp/p.max_hp);
      for(const p of world.players){if(p.rip&&!wasDead[p.name])deaths.push({at:Date.now(),name:p.name,
        attackers:world.attackers.filter((a:any)=>a.target===p.name).map((a:any)=>a.mtype)});wasDead[p.name]=p.rip;}
      samples.push({at:Date.now(),tankMode,...world});
      await waitForGameplay(2000);
    }
  }finally{
    const summary={tank,deaths:deaths.length,peakAttackers:peak,minHp:Math.round(minHp*100)/100,deathLog:deaths,
      attackerHistogram:samples.reduce((h:Record<number,number>,s)=>(h[s.attackers.length]=(h[s.attackers.length]||0)+1,h),{})};
    console.log('FARM-SUMMARY '+JSON.stringify(summary));
    await info.attach('targetron-farm-summary',{body:JSON.stringify(summary),contentType:'application/json'});
    await info.attach('targetron-farm-samples',{body:JSON.stringify(samples),contentType:'application/json'});
  }
  expect(samples.length).toBeGreaterThan(10);
});
