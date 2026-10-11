import {test,expect} from './live-fixtures';
import {W,P,evidence} from './hunt-interruption-helpers';

for(const primaryClass of ['warrior','mage'] as const){
  test.describe(primaryClass,()=>{
    test.use({primaryClass,loadout:'combat-range',initialPosition:{map:'level1',x:0,y:395.76}});
    test('fighters route through multiple level1 corners to a visible combat target',async({live},info)=>{
      test.setTimeout(180000);
      await live.post('/merchant/force-stand',{enabled:true});
      const origin=await live.clients[W].run('({x:character.real_x,y:character.real_y,range:character.range,speed:character.speed,blocked:!can_move_to(-11,115)})');
      const geometry=await live.clients[W].run(`({base:character.base,own:can_move_to(character.real_x,character.real_y),steps:Array.from({length:8},(_,i)=>{const a=i*Math.PI/4,x=character.real_x+24*Math.cos(a),y=character.real_y+24*Math.sin(a);return {x,y,clear:can_move_to(x,y)};})})`);
      await info.attach('native-origin-geometry',{body:JSON.stringify(geometry),contentType:'application/json'});
      expect(origin.blocked,'The screenshot target must be across native terrain').toBe(true);
      await live.admin(`output=(()=>{for(const m of Object.values(instances.level1.monsters))remove_monster(m,{method:'disappear',nospawn:true});for(let i=monster_respawns.length-1;i>=0;i--)if(monster_respawns[i][0]?.map==='level1')monster_respawns.splice(i,1);return true;})()`);
      await live.post('/formation',{leader:W});
      await live.post('/formation',{character:P,follow:true});
      await live.post('/focus',{monsterFocus:['prat'],monsterPriorities:{prat:999},monsterSearchRadius:800});
      await live.post('/farming-mode',{character:W,mode:'default'});
      await live.post('/checkpoint',{});
      const seed=await live.admin(`output=(()=>{const original=G.monsters.prat;globalThis.__multiCornerOriginal=original;G.monsters.prat={...original,speed:0,charge:0,hp:10000000};const m=new_monster('level1',{type:'prat',count:1,position:[-11,115],radius:0},{temp:1});m.speed=0;m.charge=0;m.hp=m.max_hp=10000000;return {id:String(m.id),x:m.x,y:m.y};})()`);
      const samples:any[]=[];
      try{
        await expect.poll(async()=>{
          for(const name of [W,P])samples.push(await live.clients[name].run(`(()=>{const p=globalThis.partyCombatPosition,d=p?.destination;return {name:character.name,at:Date.now(),x:character.real_x,y:character.real_y,routeState:globalThis.partyQueueClient?.formation?.approachStatus?.(),positioning:p,clear:d?can_move({map:character.map,x:character.real_x,y:character.real_y,going_x:d.x,going_y:d.y,base:character.base}):null};})()`));
          return Promise.all([W,P].map(async name=>(await live.clients[name].events()).some((e:any)=>e.event==='hit'&&String(e.data?.id)===seed.id&&e.data?.hid===name&&e.data?.damage>1)));
        },{timeout:45000,intervals:[100,250],message:'Both native fighters must round the corridor and attack'}).toEqual([true,true]);
        const routed=samples.filter(s=>s.positioning?.movementOwner==='combat'&&s.positioning?.target===seed.id&&s.positioning?.destination);
        expect(routed.length).toBeGreaterThan(0);
        expect(routed.every(s=>s.clear),'Every observed combat segment must clear native terrain').toBe(true);
        for(const name of [W,P]){
          const own=samples.filter(s=>s.name===name),first=own.find(s=>Math.hypot(s.x-origin.x,s.y-origin.y)>8);
          const acquired=own.find(s=>s.positioning?.target===seed.id);
          expect(first,'Each fighter must start moving around the blockage').toBeTruthy();
          expect(acquired,'Each fighter must acquire the encounter').toBeTruthy();
          expect(first.at-acquired.at,'Combat recovery must begin promptly after target acquisition').toBeLessThan(3500);
          expect(first.at-own[0].at,'Target acquisition and recovery must stay bounded').toBeLessThan(6000);
        }
        expect(samples.some(s=>Math.abs(s.x-origin.x)>60),'Combat recovery must turn away from the blocked direct bearing').toBe(true);
        for(const name of [W,P])expect(await live.clients[name].run('character.rip')).toBeFalsy();
      }finally{
        await evidence(live,info,'multi-corner-native-combat',{primaryClass,origin,seed,samples});
        await info.attach('level1-combat-view',{body:await live.clients[W].page.screenshot(),contentType:'image/png'});
        await live.admin(`output=(()=>{const m=instances.level1.monsters[${JSON.stringify(seed.id)}];if(m)remove_monster(m,{silent:true});if(globalThis.__multiCornerOriginal)G.monsters.prat=globalThis.__multiCornerOriginal;return true;})()`);
      }
    });
  });
}
