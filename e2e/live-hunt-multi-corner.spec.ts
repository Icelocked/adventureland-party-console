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
      let seed:any;
      const samples:any[]=[],timings:any[]=[];
      try{
        await Promise.all([W,P].map(name=>live.clients[name].run(`(()=>{
          const old=globalThis.__e2eCombatRecoveryTiming;if(old)clearInterval(old.timer);
          const state={name:character.name,origin:{x:character.real_x,y:character.real_y},targets:{},samples:[],cadence:{calls:0,maxGap:0,lastAt:undefined}};
          const observe=()=>{const at=Date.now(),previous=state.cadence.lastAt,gap=previous===undefined?0:at-previous;
            state.cadence.lastAt=at;state.cadence.calls++;state.cadence.maxGap=Math.max(state.cadence.maxGap,gap);
            const position=globalThis.partyCombatPosition,id=position?.target;if(!id)return;
            const target=state.targets[String(id)]??=( {acquiredAt:at} ),displacement=Math.hypot(character.real_x-state.origin.x,character.real_y-state.origin.y);
            if(target.firstDisplacementAt===undefined&&displacement>1)target.firstDisplacementAt=at;
            if(target.firstIntentAt===undefined&&position?.destination)target.firstIntentAt=at;
            if(target.movedAt===undefined&&displacement>8)target.movedAt=at;
            const status=globalThis.partyQueueClient?.formation?.approachStatus?.(),key=JSON.stringify([id,position?.mode,status,position?.intent,position?.movementOwner,position?.destination]);
            if(state.samples.length<100&&(key!==state.lastKey||gap>100||displacement>1&&target.firstDisplacementAt===at||target.movedAt===at))
              state.samples.push({at,gap,target:id,x:character.real_x,y:character.real_y,displacement,status,position:{...position,destination:position?.destination?{...position.destination}:undefined}});
            state.lastKey=key;};
          state.timer=setInterval(observe,25);globalThis.__e2eCombatRecoveryTiming=state;observe();return true;
        })()`)));
        seed=await live.admin(`output=(()=>{const original=G.monsters.prat;globalThis.__multiCornerOriginal=original;G.monsters.prat={...original,stationary:true};const m=new_monster('level1',{type:'prat',count:1,position:[-11,115],radius:0},{temp:1});m.speed=0;m.moving=false;m.hp=m.max_hp=10000000;m.abs=true;m.u=true;m.cid++;return {id:String(m.id),x:m.x,y:m.y,at:Date.now(),wire:monster_to_client(m)};})()`);
        expect(seed.wire.speed).toBe(0);expect(seed.wire.hp).toBe(10000000);expect(seed.wire.max_hp).toBe(10000000);
        await expect.poll(async()=>Promise.all([W,P].map(name=>live.clients[name].run(`(()=>{
          const t=parent.entities[${JSON.stringify(seed.id)}];return !!t&&t.max_hp===10000000&&!t.moving&&
            Math.hypot((t.real_x??t.x)-(${seed.x}),(t.real_y??t.y)-(${seed.y}))<1;
        })()`))),{timeout:30000,message:'Both real clients must observe the declared stationary Prat wire overrides'}).toEqual([true,true]);
        await expect.poll(async()=>{
          for(const name of [W,P])samples.push(await live.clients[name].run(`(()=>{const p=globalThis.partyCombatPosition,d=p?.destination;return {name:character.name,at:Date.now(),x:character.real_x,y:character.real_y,routeState:globalThis.partyQueueClient?.formation?.approachStatus?.(),positioning:p,clear:d?can_move({map:character.map,x:character.real_x,y:character.real_y,going_x:d.x,going_y:d.y,base:character.base}):null};})()`));
          return Promise.all([W,P].map(async name=>(await live.clients[name].events()).some((e:any)=>e.event==='hit'&&String(e.data?.id)===seed.id&&e.data?.hid===name&&e.data?.damage>1)));
        },{timeout:45000,intervals:[100,250],message:'Both native fighters must round the corridor and attack'}).toEqual([true,true]);
        const routed=samples.filter(s=>s.positioning?.movementOwner==='combat'&&s.positioning?.target===seed.id&&s.positioning?.destination);
        expect(routed.length).toBeGreaterThan(0);
        expect(routed.every(s=>s.clear),'Every observed combat segment must clear native terrain').toBe(true);
        for(const name of [W,P]){
          const timing=await live.clients[name].run(`(()=>{const s=globalThis.__e2eCombatRecoveryTiming;return {name:s.name,origin:s.origin,targets:s.targets,cadence:s.cadence,samples:s.samples};})()`);
          timings.push(timing);
          const observed=timing.targets[seed.id];
          const own=samples.filter(s=>s.name===name),first=own.find(s=>Math.hypot(s.x-origin.x,s.y-origin.y)>8);
          const acquired=own.find(s=>s.positioning?.target===seed.id);
          expect(first,'Each fighter must start moving around the blockage').toBeTruthy();
          expect(acquired,'Each fighter must acquire the encounter').toBeTruthy();
          expect(observed?.movedAt,'The native client must observe displacement for this target').toBeTruthy();
          expect(observed.movedAt-observed.acquiredAt,'Combat recovery must begin promptly after target acquisition').toBeLessThan(3500);
          expect(observed.movedAt-seed.at,'Target acquisition and recovery must stay bounded').toBeLessThan(6000);
        }
        expect(samples.some(s=>Math.abs(s.x-origin.x)>60),'Combat recovery must turn away from the blocked direct bearing').toBe(true);
        for(const name of [W,P])expect(await live.clients[name].run('character.rip')).toBeFalsy();
      }finally{
        const retained=await Promise.allSettled([W,P].map(name=>live.clients[name].run(`(()=>{const s=globalThis.__e2eCombatRecoveryTiming;if(!s)return null;clearInterval(s.timer);delete globalThis.__e2eCombatRecoveryTiming;return {name:s.name,origin:s.origin,targets:s.targets,cadence:s.cadence,samples:s.samples};})()`)));
        await info.attach('native-combat-recovery-timing',{body:JSON.stringify({timings,retained}),contentType:'application/json'});
        await evidence(live,info,'multi-corner-native-combat',{primaryClass,origin,seed,samples});
        await info.attach('level1-combat-view',{body:await live.clients[W].page.screenshot(),contentType:'image/png'});
        await live.admin(`output=(()=>{const m=instances.level1.monsters[${JSON.stringify(seed?.id)}];if(m)remove_monster(m,{silent:true});if(globalThis.__multiCornerOriginal)G.monsters.prat=globalThis.__multiCornerOriginal;return true;})()`);
      }
    });
  });
}
