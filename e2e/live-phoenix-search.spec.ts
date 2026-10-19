import {test,expect} from './live-fixtures';
import {W,P,M,world,quantity} from './game/hunt-events';
import {zones} from '../dashboard/lib/farming-zones';

// Failure inventory: e2e/phoenix-search-failures.md. This journey covers the
// split search, holding fire while converging, the cross-map converge, the kill,
// spreading out before the respawn, and finding the native respawn again.
const SEEDED_HP=12000, GATHER_RANGE=300;
const inside=(b:number[],p:{x:number;y:number})=>p.x>=b[0]&&p.x<=b[2]&&p.y>=b[1]&&p.y<=b[3];

test('Phoenix patrol splits the fighters, holds fire until they gather, then spreads out for the respawn',async({live},info)=>{
  test.setTimeout(1_500_000);
  const timeline:any[]=[];
  let sampling=true;
  const sample=async()=>{
    while(sampling) {
      try {
        const [state,positions]=await Promise.all([live.state(),world(live)]);
        timeline.push({at:Date.now(),rare:state.rareHuntState,positions:Object.fromEntries([W,P].map(n=>[n,{map:positions.players[n].map,x:Math.round(positions.players[n].x),y:Math.round(positions.players[n].y),hp:positions.players[n].hp}]))});
      } catch(error) { timeline.push({at:Date.now(),error:String(error)}); }
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
  };
  let sampler:Promise<void>|undefined;
  try {
    await live.post('/formation',{leader:W});
    await live.post('/formation',{character:P,follow:true});
    await expect.poll(async()=>(await live.state(true)).monsterChoices?.find((m:any)=>m.id==='phoenix')?.locations?.length,{timeout:120_000}).toBe(5);
    const catalog=(await live.state(true)).monsterChoices;
    const regions=zones(catalog,['phoenix']);
    const order=regions.map(a=>a.id!);
    const region=(p:{map:string;x:number;y:number})=>regions.find(a=>a.map===p.map&&inside(a.boundary!,p))?.id||null;

    // Declared fixture: replace the server's Phoenix with one from its own
    // randomrespawn definition, pinned to Spooky Forest and with bounded HP so
    // the fight ends. Its death uses the unmodified definition, so the respawn
    // is native: random region, full HP.
    const seeded=await live.admin(`output=(()=>{
      const found=[];for(const instance of Object.values(instances))for(const m of Object.values(instance.monsters||{}))if(m.type==='phoenix'&&!m.dead)found.push(m);
      if(found.length!==1)throw Error('Expected one native Phoenix, found '+found.length);
      const native=found[0],definition=native.map_def,boundaries=definition.boundaries,original=G.monsters.phoenix;
      remove_monster(native,{nospawn:true,silent:true});
      try {
        definition.boundaries=boundaries.filter(b=>b[0]==='halloween');
        G.monsters.phoenix={...original,hp:${SEEDED_HP},attack:1};
        const m=new_monster('halloween',definition,{});
        m.drops=[[1000000,'gem0',1]];
        return {id:m.id,map:m.map,in:m.in,x:m.x,y:m.y,hp:m.hp,max_hp:m.max_hp,speed:m.speed,removed:{id:native.id,map:native.map,x:native.x,y:native.y}};
      } finally {definition.boundaries=boundaries;G.monsters.phoenix=original;}
    })()`);
    await info.attach('phoenix-seeded-encounter',{body:JSON.stringify(seeded),contentType:'application/json'});
    expect(seeded.map).toBe('halloween');
    expect(seeded.hp).toBe(SEEDED_HP);

    const before=await world(live);
    await live.post('/navigate-to-monster',{monsterId:'phoenix',phoenixRouteOrder:order});
    sampler=sample();

    // 1. The fighters split up instead of travelling together.
    await expect.poll(async()=>{
      const searchers=(await live.state()).rareHuntState?.patrol?.searchers||{};
      return !!searchers[W]&&!!searchers[P]&&searchers[W].regionId!==searchers[P].regionId;
    },{timeout:120_000,message:'Both fighters must receive different spawn regions'}).toBe(true);
    await expect.poll(async()=>{
      const s=await world(live),a=region(s.players[W]),b=region(s.players[P]);
      return (!!a&&!!b&&a!==b)||(await live.state()).rareHuntState?.encounter?.targetId===seeded.id;
    },{timeout:600_000,intervals:[1000],message:'The fighters must stand in different spawn regions while searching'}).toBe(true);

    // 2. Somebody spots it; nobody attacks until everyone is in range.
    await expect.poll(async()=>(await live.state()).rareHuntState?.encounter?.targetId,{timeout:900_000,intervals:[1000],
      message:'A searcher must find the seeded Phoenix in Spooky Forest'}).toBe(seeded.id);
    await expect.poll(async()=>(await live.state()).rareHuntState?.encounter?.gatheredAt||0,{timeout:600_000,intervals:[500],
      message:'Both fighters must converge on the Phoenix'}).toBeGreaterThan(0);
    const gathered=(await live.state()).rareHuntState.encounter;
    expect(gathered.gatheredWithout,'Every fighter must gather before the deadline').toEqual([]);
    const hits=async()=>(await Promise.all([W,P].map(name=>live.clients[name].events()))).flat()
      .filter((event:any)=>event.event==='hit'&&String(event.data?.id)===String(seeded.id)&&[W,P].includes(event.data?.hid)&&event.data?.damage>0);
    await expect.poll(async()=>(await hits()).length,{timeout:120_000,message:'The gathered party must attack the Phoenix'}).toBeGreaterThan(0);
    const firstHit=Math.min(...(await hits()).map((event:any)=>event.at));
    expect(firstHit,'No party hit may land before every fighter is in range').toBeGreaterThanOrEqual(gathered.gatheredAt);
    const atGather=timeline.filter(s=>s.positions&&Math.abs(s.at-gathered.gatheredAt)<=2000);
    await info.attach('phoenix-hold-fire-until-gathered',{body:JSON.stringify({gathered,firstHit,atGather},null,2),contentType:'application/json'});

    // 3. Real combat kills it and the guaranteed drop is looted.
    await expect.poll(async()=>live.admin(`output=!!Object.values(instances).some(i=>i.monsters[${JSON.stringify(seeded.id)}])`),
      {timeout:180_000,message:'Real combat must kill the seeded Phoenix'}).toBe(false);
    const gems=(snapshot:any)=>[W,P,M].reduce((sum,name)=>sum+quantity(snapshot.players[name].items,'gem0'),0);
    await expect.poll(async()=>gems(await world(live)),{timeout:60_000,message:'The guaranteed drop must reach party inventory'}).toBeGreaterThan(gems(before));

    // 4. After the kill the fighters spread out before the respawn.
    await expect.poll(async()=>{
      const patrol=(await live.state()).rareHuntState?.patrol;
      return patrol?.stage==='respawn'&&!!patrol.searchers?.[P];
    },{timeout:60_000,message:'The non-leader must leave to pre-position while the respawn timer runs'}).toBe(true);
    const respawn=(await live.state()).rareHuntState.patrol;
    expect(respawn.readyAt).toBeGreaterThan(Date.now()-5000);
    await expect.poll(async()=>{
      const searchers=(await live.state()).rareHuntState?.patrol?.searchers||{};
      return !!searchers[W]&&!!searchers[P]&&searchers[W].regionId!==searchers[P].regionId;
    },{timeout:60_000,message:'Both fighters must head to different regions for the respawn'}).toBe(true);
    await info.attach('phoenix-respawn-spread',{body:JSON.stringify((await live.state()).rareHuntState,null,2),contentType:'application/json'});

    // 5. The native respawn (random region, full HP) is found again.
    await expect.poll(async()=>{
      const id=(await live.state()).rareHuntState?.encounter?.targetId;
      return !!id&&id!==seeded.id;
    },{timeout:900_000,intervals:[1000],message:'The search must find the native respawn'}).toBe(true);
    const second=(await live.state()).rareHuntState.encounter;
    const respawned=await live.admin(`output=Object.values(instances).flatMap(i=>Object.values(i.monsters||{})).filter(m=>m.type==='phoenix'&&!m.dead).map(m=>({id:m.id,map:m.map,x:m.x,y:m.y,hp:m.hp,max_hp:m.max_hp}))`);
    await info.attach('phoenix-native-respawn-found',{body:JSON.stringify({second,respawned},null,2),contentType:'application/json'});
    expect(respawned.map((m:any)=>String(m.id))).toContain(String(second.targetId));
  } finally {
    sampling=false;
    await sampler;
    const summary={
      gatherRange:GATHER_RANGE,
      encounters:[...new Set(timeline.map(s=>s.rare?.encounter?.targetId).filter(Boolean))],
      stages:timeline.map(s=>({at:s.at,patrol:s.rare?.patrol?.stage,encounter:s.rare?.encounter?.stage,message:s.rare?.message})),
    };
    await info.attach('phoenix-search-timeline',{body:JSON.stringify({summary,timeline},null,2),contentType:'application/json'});
  }
});

// Failure 15a: the Phoenix already fights one fighter before the party gathers.
// The spotter engages at once; the other fighter must keep converging and join.
test('Phoenix already fighting the spotter: the other fighter keeps converging and joins the fight',async({live},info)=>{
  test.setTimeout(1_200_000);
  const timeline:any[]=[];
  let sampling=true;
  const sample=async()=>{
    while(sampling) {
      try {
        const [state,positions]=await Promise.all([live.state(),world(live)]);
        timeline.push({at:Date.now(),encounter:state.rareHuntState?.encounter,
          positions:Object.fromEntries([W,P].map(n=>[n,{map:positions.players[n].map,x:Math.round(positions.players[n].x),y:Math.round(positions.players[n].y)}]))});
      } catch(error) { timeline.push({at:Date.now(),error:String(error)}); }
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
  };
  let sampler:Promise<void>|undefined;
  try {
    await live.post('/formation',{leader:W});
    await live.post('/formation',{character:P,follow:true});
    await expect.poll(async()=>(await live.state(true)).monsterChoices?.find((m:any)=>m.id==='phoenix')?.locations?.length,{timeout:120_000}).toBe(5);
    const order=zones((await live.state(true)).monsterChoices,['phoenix']).map(a=>a.id!);
    // Declared fixture: as in the first journey, but with enough HP that the spotter
    // cannot finish it alone before the other fighter arrives.
    const seeded=await live.admin(`output=(()=>{
      const found=[];for(const instance of Object.values(instances))for(const m of Object.values(instance.monsters||{}))if(m.type==='phoenix'&&!m.dead)found.push(m);
      if(found.length!==1)throw Error('Expected one native Phoenix, found '+found.length);
      const native=found[0],definition=native.map_def,boundaries=definition.boundaries,original=G.monsters.phoenix;
      remove_monster(native,{nospawn:true,silent:true});
      try {
        definition.boundaries=boundaries.filter(b=>b[0]==='halloween');
        G.monsters.phoenix={...original,hp:2000000,attack:1};
        const m=new_monster('halloween',definition,{});
        return {id:m.id,map:m.map,x:m.x,y:m.y,hp:m.hp};
      } finally {definition.boundaries=boundaries;G.monsters.phoenix=original;}
    })()`);
    await live.post('/navigate-to-monster',{monsterId:'phoenix',phoenixRouteOrder:order});
    sampler=sample();
    await expect.poll(async()=>(await live.state()).rareHuntState?.encounter?.targetId,{timeout:900_000,intervals:[500],
      message:'A searcher must find the seeded Phoenix'}).toBe(seeded.id);

    // The Phoenix aggroes the fighter nearest to it, before the other one gathers.
    const aggro=await live.admin(`output=(()=>{
      const m=Object.values(instances.halloween.monsters).find(m=>m.id===${JSON.stringify(seeded.id)});
      const near=Object.values(players).filter(p=>p.map==='halloween'&&[${JSON.stringify(W)},${JSON.stringify(P)}].includes(p.name))
        .sort((a,b)=>Math.hypot(a.x-m.x,a.y-m.y)-Math.hypot(b.x-m.x,b.y-m.y))[0];
      if(!near)throw Error('No fighter on the Phoenix map');
      target_player(m,near);
      const others=Object.values(players).filter(p=>[${JSON.stringify(W)},${JSON.stringify(P)}].includes(p.name)&&p.name!==near.name)
        .map(p=>({name:p.name,map:p.map,x:p.x,y:p.y,distance:p.map===m.map?Math.hypot(p.x-m.x,p.y-m.y):null}));
      return {spotter:near.name,target:m.target,phoenix:{x:m.x,y:m.y},others,at:Date.now()};
    })()`);
    await info.attach('phoenix-aggro-before-gather',{body:JSON.stringify(aggro,null,2),contentType:'application/json'});
    const walker=aggro.others[0];
    expect(walker.distance===null||walker.distance>300,'The other fighter must still be converging when the fight starts').toBe(true);

    const hitsBy=async(name:string)=>(await live.clients[name].events())
      .filter((event:any)=>event.event==='hit'&&String(event.data?.id)===String(seeded.id)&&event.data?.hid===name&&event.data?.damage>0);
    await expect.poll(async()=>(await hitsBy(aggro.spotter)).length,{timeout:60_000,message:'The spotter must fight the Phoenix that targets it'}).toBeGreaterThan(0);
    const spotterFirstHit=Math.min(...(await hitsBy(aggro.spotter)).map((event:any)=>event.at));

    // The other fighter keeps walking in while the spotter fights, then joins.
    const distance=async()=>live.admin(`output=(()=>{
      const m=Object.values(instances.halloween.monsters).find(m=>m.id===${JSON.stringify(seeded.id)});
      const p=Object.values(players).find(p=>p.name===${JSON.stringify(walker.name)});
      return m&&p&&p.map===m.map?Math.hypot(p.x-m.x,p.y-m.y):null;
    })()`);
    await expect.poll(async()=>{const d=await distance();return d!==null&&d<=300;},{timeout:600_000,intervals:[1000],
      message:'The other fighter must keep converging after the spotter starts fighting'}).toBe(true);
    const arrivedAt=Date.now();
    await expect.poll(async()=>(await hitsBy(walker.name)).length,{timeout:120_000,message:'The arriving fighter must join the fight'}).toBeGreaterThan(0);
    const walkerFirstHit=Math.min(...(await hitsBy(walker.name)).map((event:any)=>event.at));
    const walkerSamples=timeline.filter(s=>s.positions&&s.at>=aggro.at).map(s=>({at:s.at,...s.positions[walker.name]}));
    await info.attach('phoenix-converge-during-fight',{body:JSON.stringify({aggro,spotterFirstHit,arrivedAt,walkerFirstHit,walkerSamples},null,2),contentType:'application/json'});
    expect(walkerFirstHit,'The arriving fighter attacks only after reaching range').toBeGreaterThanOrEqual(arrivedAt-5000);
  } finally {
    sampling=false;
    await sampler;
    await info.attach('phoenix-converge-timeline',{body:JSON.stringify(timeline,null,2),contentType:'application/json'});
  }
});

// Failure 8a: a lone searcher attacked by aggressive monsters must defend itself
// and keep searching. Live, FonzeWarrior shuffled in place at this bee spawn.
test.describe('searcher under attack',()=>{
  const beeSpawn={map:'main',x:150,y:1490};
  test.use({initialPosition:beeSpawn});
  test('Phoenix searchers starting on an aggressive spawn defend themselves and cover a region',async({live},info)=>{
    test.setTimeout(600_000);
    await live.post('/formation',{leader:W});
    await live.post('/formation',{character:P,follow:true});
    await expect.poll(async()=>(await live.state(true)).monsterChoices?.find((m:any)=>m.id==='phoenix')?.locations?.length,{timeout:120_000}).toBe(5);
    const order=zones((await live.state(true)).monsterChoices,['phoenix']).map(a=>a.id!);
    // Declared fixture: no Phoenix on the server, so only searching is observed.
    const removed=await live.admin(`output=Object.values(instances).flatMap(i=>Object.values(i.monsters||{})).filter(m=>m.type==='phoenix'&&!m.dead).map(m=>{remove_monster(m,{nospawn:true,silent:true});return {id:m.id,map:m.map}})`);
    const bees=await live.admin(`output=Object.values(instances.main.monsters).filter(m=>(m.type==='bee'||m.type==='poisio')&&Math.hypot(m.x-${beeSpawn.x},m.y-${beeSpawn.y})<400).map(m=>({id:m.id,type:m.type,x:m.x,y:m.y}))`);
    await info.attach('aggressive-spawn-fixture',{body:JSON.stringify({beeSpawn,removed,bees},null,2),contentType:'application/json'});
    expect(bees.length,'The starting point must be next to aggressive monsters').toBeGreaterThan(0);
    await live.post('/navigate-to-monster',{monsterId:'phoenix',phoenixRouteOrder:order});
    const samples:any[]=[];
    await expect.poll(async()=>{
      const [state,positions]=await Promise.all([live.state(),world(live)]);
      const patrol=state.rareHuntState?.patrol;
      samples.push({at:Date.now(),covered:patrol?.covered?.length||0,retryReason:patrol?.retryReason||null,
        positions:Object.fromEntries([W,P].map(n=>[n,{map:positions.players[n].map,x:Math.round(positions.players[n].x),y:Math.round(positions.players[n].y),hp:positions.players[n].hp}]))});
      return patrol?.covered?.length||0;
    },{timeout:300_000,intervals:[2000],message:'Searchers must leave the aggressive spawn and finish checking a region'}).toBeGreaterThan(0);
    const hits=(await Promise.all([W,P].map(name=>live.clients[name].events()))).flat()
      .filter((event:any)=>event.event==='hit'&&[W,P].includes(event.data?.hid)&&bees.some((b:any)=>String(b.id)===String(event.data?.id)));
    await info.attach('searcher-defense-timeline',{body:JSON.stringify({hitsOnSpawnMonsters:hits.length,samples},null,2),contentType:'application/json'});
    expect(samples.every(s=>!/no movement progress/.test(s.retryReason||'')),'Defending must not stall the search into the watchdog').toBe(true);
  });
});

// Failure 13a: a fighter far from a wandering Phoenix must keep its converge
// route instead of restarting it (and its town warp) on every sighting.
test.describe('far fighter converging on a wandering Phoenix',()=>{
  const strip={x:-1180,y:800}, east={map:'main',x:1100,y:-200};
  test.use({initialPositions:{[P]:{map:'main',...strip},[W]:east}});
  test('A fighter across Mainland keeps its converge route while the Phoenix wanders',async({live},info)=>{
    test.setTimeout(900_000);
    const timeline:any[]=[];
    let sampling=true;
    const sample=async()=>{
      while(sampling) {
        try {
          const [state,positions,phoenix]=await Promise.all([live.state(),world(live),
            live.admin(`output=Object.values(instances.main?.monsters||{}).filter(m=>m.type==='phoenix'&&!m.dead).map(m=>({x:Math.round(m.x),y:Math.round(m.y)}))[0]||null`)]);
          timeline.push({at:Date.now(),encounter:state.rareHuntState?.encounter,phoenix,
            positions:Object.fromEntries([W,P].map(n=>[n,{map:positions.players[n].map,x:Math.round(positions.players[n].x),y:Math.round(positions.players[n].y)}]))});
        } catch(error) { timeline.push({at:Date.now(),error:String(error)}); }
        await new Promise(resolve=>setTimeout(resolve,1000));
      }
    };
    let sampler:Promise<void>|undefined;
    try {
      await live.post('/formation',{leader:W});
      await live.post('/formation',{character:P,follow:true});
      await expect.poll(async()=>(await live.state(true)).monsterChoices?.find((m:any)=>m.id==='phoenix')?.locations?.length,{timeout:120_000}).toBe(5);
      const order=zones((await live.state(true)).monsterChoices,['phoenix']).map(a=>a.id!);
      // Declared fixture: the native Phoenix, pinned to the west strip where the
      // live stall happened. It keeps its native speed and wanders natively.
      const seeded=await live.admin(`output=(()=>{
        const found=[];for(const instance of Object.values(instances))for(const m of Object.values(instance.monsters||{}))if(m.type==='phoenix'&&!m.dead)found.push(m);
        if(found.length!==1)throw Error('Expected one native Phoenix, found '+found.length);
        const native=found[0],definition=native.map_def,boundaries=definition.boundaries,original=G.monsters.phoenix;
        remove_monster(native,{nospawn:true,silent:true});
        try {
          definition.boundaries=boundaries.filter(b=>b[0]==='main'&&b[1]===-1358);
          G.monsters.phoenix={...original,hp:2000000,attack:1};
          const m=new_monster('main',definition,{});
          return {id:m.id,map:m.map,x:m.x,y:m.y,hp:m.hp,speed:m.speed};
        } finally {definition.boundaries=boundaries;G.monsters.phoenix=original;}
      })()`);
      await live.post('/navigate-to-monster',{monsterId:'phoenix',phoenixRouteOrder:order});
      sampler=sample();
      await expect.poll(async()=>(await live.state()).rareHuntState?.encounter?.targetId,{timeout:300_000,intervals:[500],
        message:'The priest on the strip must spot the seeded Phoenix'}).toBe(seeded.id);
      const spottedAt=Date.now();
      const start=await world(live);
      await expect.poll(async()=>(await live.state()).rareHuntState?.encounter?.gatheredAt||0,{timeout:420_000,intervals:[500],
        message:'The far fighter must converge on the wandering Phoenix'}).toBeGreaterThan(0);
      const state=await live.state();
      const encounter=state.rareHuntState?.encounter;
      // Whoever the patrol sent away from the strip is the far fighter.
      const sightedAt=timeline.find(s=>s.at>=spottedAt&&s.phoenix);
      const away=(name:string)=>{const p=start.players[name],m=sightedAt?.phoenix;return !m||p.map!=='main'?Infinity:Math.hypot(p.x-m.x,p.y-m.y);};
      const far=away(W)>=away(P)?W:P;
      const restartsOf=(name:string)=>(state.combatLogs?.[name]?.events||state.combatLogs?.[name]||[]).filter((e:any)=>e.at>=spottedAt&&e.at<=encounter.gatheredAt&&
        /cancelRarePath/.test(e.details?.failureContext?.stopStack||''));
      const restarts=restartsOf(far);
      const warpsInterrupted=restarts.filter((e:any)=>e.details?.progress?.phase==='town warp');
      const phoenixPath=timeline.filter(s=>s.at>=spottedAt&&s.phoenix).map(s=>({at:s.at,...s.phoenix}));
      await info.attach('phoenix-far-converge',{body:JSON.stringify({seeded,spottedAt,gatheredAt:encounter.gatheredAt,
        convergeMs:encounter.gatheredAt-spottedAt,far,distanceAtSighting:{[W]:away(W),[P]:away(P)},
        restartsByFighter:{[W]:restartsOf(W).length,[P]:restartsOf(P).length},start:{[W]:start.players[W],[P]:start.players[P]},
        restarts:restarts.map((e:any)=>({at:e.at,phase:e.details?.progress?.phase,destination:e.details?.failureContext?.destination})),
        warpsInterrupted:warpsInterrupted.length,phoenixPath},null,2),contentType:'application/json'});
      const wandered=Math.max(0,...phoenixPath.map((p:any)=>Math.hypot(p.x-phoenixPath[0].x,p.y-phoenixPath[0].y)));
      expect(away(far),'The far fighter must start well away from the Phoenix').toBeGreaterThan(1000);
      expect(wandered,'The fixture is only meaningful if the Phoenix wanders while the fighter converges').toBeGreaterThan(300);
      expect(encounter.gatheredWithout,'The far fighter must gather before the deadline').toEqual([]);
      expect(warpsInterrupted.length,'Re-aiming must never interrupt a town warp').toBe(0);
      expect(restarts.length,'The far fighter must keep its route while the Phoenix wanders').toBeLessThanOrEqual(10);
    } finally {
      sampling=false;
      await sampler;
      await info.attach('phoenix-far-converge-timeline',{body:JSON.stringify(timeline,null,2),contentType:'application/json'});
    }
  });

});

// Failure 8c: one fighter's own condition must not end the converge. The leader
// (warrior) waits on the strip and spots; the follower (priest) is the busy one,
// standing in town as after a merchant handoff, as the live case was.
test.describe('converging fighter busy in town',()=>{
  test.use({initialPositions:{[W]:{map:'main',x:-1180,y:800},[P]:{map:'main',x:1100,y:-200}}});
  test('A converging fighter dropping to low HP mid-converge does not end the encounter for the others',async({live},info)=>{
    test.setTimeout(900_000);
    const encounters:any[]=[];
    const diagnostics=new Map<string,any>();
    const statusCancels=new Map<string,{who:string;at:number}>();
    let sampling=true;
    const sample=async()=>{
      while(sampling) {
        try {
          const [state,positions,phoenix]=await Promise.all([live.state(),world(live),
            live.admin(`output=Object.values(instances.main?.monsters||{}).filter(m=>m.type==='phoenix'&&!m.dead).map(m=>({x:Math.round(m.x),y:Math.round(m.y)}))[0]||null`)]);
          const e=state.rareHuntState?.encounter;
          for(const [who,list] of Object.entries(state.combatLogs||{}))for(const entry of ((list as any)?.events||list||[])) {
            if(/withheld|Rare pursuit ended|gathered/.test(entry.message))diagnostics.set(who+entry.at+entry.message+JSON.stringify(entry.details),{who,...entry});
            // Failure 8e: the status loop cancelling a resent converge route.
            if(/cancelRarePath[\s\S]*\btick\b/.test(entry.details?.failureContext?.stopStack||''))statusCancels.set(who+entry.at,{who,at:entry.at});
          }
          encounters.push({at:Date.now(),id:e?.id||null,stage:e?.stage||null,message:state.rareHuntState?.message||null,
            freshness:Object.fromEntries([W,P].map(n=>[n,{age:Date.now()-Number(state.characters?.[n]?.seenAt||0),server:state.characters?.[n]?.server,
              rareNav:state.characters?.[n]?.rareNavigation||null}])),
            searchers:Object.keys(state.rareHuntState?.patrol?.searchers||{}),phoenix,
            positions:Object.fromEntries([W,P].map(n=>[n,{map:positions.players[n].map,x:Math.round(positions.players[n].x),y:Math.round(positions.players[n].y),hp:positions.players[n].hp}]))});
        } catch(error) { encounters.push({at:Date.now(),error:String(error)}); }
        await new Promise(resolve=>setTimeout(resolve,500));
      }
    };
    let sampler:Promise<void>|undefined;
    try {
      await live.post('/formation',{leader:W});
      await live.post('/formation',{character:P,follow:true});
      await expect.poll(async()=>(await live.state(true)).monsterChoices?.find((m:any)=>m.id==='phoenix')?.locations?.length,{timeout:120_000}).toBe(5);
      const order=zones((await live.state(true)).monsterChoices,['phoenix']).map(a=>a.id!);
      // Declared fixture: as above, the native Phoenix pinned to the west strip.
      const seeded=await live.admin(`output=(()=>{
        const found=[];for(const instance of Object.values(instances))for(const m of Object.values(instance.monsters||{}))if(m.type==='phoenix'&&!m.dead)found.push(m);
        if(found.length!==1)throw Error('Expected one native Phoenix, found '+found.length);
        const native=found[0],definition=native.map_def,boundaries=definition.boundaries,original=G.monsters.phoenix;
        remove_monster(native,{nospawn:true,silent:true});
        try {
          definition.boundaries=boundaries.filter(b=>b[0]==='main'&&b[1]===-1358);
          G.monsters.phoenix={...original,hp:2000000,attack:1};
          const m=new_monster('main',definition,{});
          return {id:m.id,map:m.map,x:m.x,y:m.y};
        } finally {definition.boundaries=boundaries;G.monsters.phoenix=original;}
      })()`);
      await live.post('/navigate-to-monster',{monsterId:'phoenix',phoenixRouteOrder:order});
      sampler=sample();
      await expect.poll(async()=>(await live.state()).rareHuntState?.encounter?.targetId,{timeout:300_000,intervals:[500],
        message:'A fighter on the strip must spot the seeded Phoenix'}).toBe(seeded.id);
      const spottedAt=Date.now();
      const first=(await live.state()).rareHuntState.encounter;
      // Declared boundary: the converging fighter (not the spotter, which keeps the
      // Phoenix in sight) drops below the 35% protection line, as FonzePriest's
      // merchant handoff took it out of the live converge.
      const spotter=/spotted by (\S+)/.exec((await live.state()).rareHuntState?.message||'')?.[1];
      expect([W,P],'The sighting must name its spotter').toContain(spotter);
      const hurt=await live.admin(`output=(()=>{
        const near=Object.values(players).find(p=>p.name===${JSON.stringify(spotter===W?P:W)});
        if(!near)throw Error('Spotter not online: '+JSON.stringify(Object.values(players).map(p=>[p.name,p.map,p.x,p.y])));
        // As a merchant handoff leaves it: hurt and waiting in town, far from the Phoenix.
        near.hp=Math.floor(near.max_hp*.2);transport_player_to(near,'main',0);resend(near,'reopen+cid');
        return {name:near.name,map:near.map,x:near.x,y:near.y,hp:near.hp,max_hp:near.max_hp,at:Date.now()};
      })()`);
      const walker=spotter;
      await expect.poll(async()=>{const s=(await live.state()).characters?.[hurt.name];return s&&s.hp/s.max_hp<.35;},
        {timeout:30_000,intervals:[250],message:'The coordinator must see the hurt fighter below 35% HP'}).toBe(true);
      const protectedSeenAt=Date.now();
      // Declared boundary: the busy fighter waits in town for 15 s, as during a
      // merchant handoff, then its condition ends.
      for(const until=Date.now()+15_000;Date.now()<until;await new Promise(resolve=>setTimeout(resolve,1000)))
        await live.admin(`output=(()=>{const p=Object.values(players).find(p=>p.name===${JSON.stringify(hurt.name)});
          if(p&&(p.map!=='main'||Math.hypot(p.x,p.y)>80))transport_player_to(p,'main',0);return true;})()`);
      const healed=await live.admin(`output=Object.values(players).filter(p=>p.name===${JSON.stringify(hurt.name)}).map(p=>{p.hp=p.max_hp;resend(p,'reopen+cid');return {hp:p.hp,max_hp:p.max_hp};})`);
      const healedAt=Date.now();
      const farAtHeal=await live.admin(`output=(()=>{const m=Object.values(instances.main.monsters).find(m=>m.id===${JSON.stringify(seeded.id)});
        const p=Object.values(players).find(p=>p.name===${JSON.stringify(hurt.name)});return m&&p&&p.map===m.map?Math.hypot(p.x-m.x,p.y-m.y):null;})()`);
      expect(farAtHeal,'The healed fighter must still have a converge walk ahead').toBeGreaterThan(800);
      await expect.poll(async()=>(await world(live)).players[hurt.name].hp/hurt.max_hp,{timeout:15_000,intervals:[500],
        message:'The declared heal must take: '+JSON.stringify(healed)}).toBeGreaterThan(.35);
      await expect.poll(async()=>(await live.state()).rareHuntState?.encounter?.gatheredAt||0,{timeout:420_000,intervals:[500],
        message:'The party must still gather on the Phoenix'}).toBeGreaterThan(0);
      const gathered=(await live.state()).rareHuntState.encounter;
      const during=encounters.filter(s=>s.at>=spottedAt&&s.at<=gathered.gatheredAt);
      const ids=[...new Set(during.map(s=>s.id))];
      const logs=(await live.state()).combatLogs||{};
      const ended=Object.values(logs).flatMap((l:any)=>l?.events||l||[]).filter((e:any)=>e.at>=hurt.at&&e.message==='Rare pursuit ended');
      const interrupted=ended.filter((e:any)=>/protected activity/.test(e.details?.reason||''));
      await info.attach('phoenix-converge-member-protected',{body:JSON.stringify({seeded,first:first.id,hurt,walker,protectedSeenAt,
        gathered:{id:gathered.id,gatheredAt:gathered.gatheredAt,gatheredWithout:gathered.gatheredWithout},ids,ended,interrupted,during},null,2),contentType:'application/json'});
      expect(interrupted,'A fighter at low HP must not end the encounter').toEqual([]);
      // A spotter can still lose sight at the edge of its view; that is entry 12's
      // lost-sighting path, unrelated to the busy member, and the search re-finds it.
      expect(ended.filter((e:any)=>e.details?.reason!=='Phoenix lost while the party converged'),
        'Only a lost sighting may end the encounter while the fighter is busy').toEqual([]);
      expect(gathered.gatheredWithout,'Both fighters must gather once the hurt fighter recovers').toEqual([]);
      const resentCancels=[...statusCancels.values()].filter(c=>c.who===hurt.name&&c.at>healedAt+3000&&c.at<=gathered.gatheredAt);
      await info.attach('phoenix-converge-resent-control',{body:JSON.stringify({healedAt,gatheredAt:gathered.gatheredAt,resentCancels},null,2),contentType:'application/json'});
      expect(resentCancels.length,'The healed fighter must keep its resent converge route (8e)').toBeLessThanOrEqual(2);
    } finally {
      sampling=false;
      await sampler;
      await info.attach('phoenix-converge-member-protected-timeline',{body:JSON.stringify({diagnostics:[...diagnostics.values()],encounters},null,2),contentType:'application/json'});
    }
  });
});

// Failure 8d: a searcher caught by an attacker it can outrun walks on instead of
// standing in the spawn fighting it alone. Live, FonzePriest healed itself at the
// Mainland Hawk spawn for over 280 s while the party waited for it.
test.describe('searcher caught by a slower attacker',()=>{
  const hawks={map:'main',x:1340,y:250};
  test.use({initialPositions:{[P]:hawks,[W]:{map:'main',x:0,y:0}}});
  test('A Phoenix searcher walks away from a hawk it can outrun and nobody fights the hawk',async({live},info)=>{
    test.setTimeout(600_000);
    await live.post('/formation',{leader:W});
    await live.post('/formation',{character:P,follow:true});
    await expect.poll(async()=>(await live.state(true)).monsterChoices?.find((m:any)=>m.id==='phoenix')?.locations?.length,{timeout:120_000}).toBe(5);
    const order=zones((await live.state(true)).monsterChoices,['phoenix']).map(a=>a.id!);
    // Declared fixture: no Phoenix on the server, so only searching is observed.
    await live.admin(`output=Object.values(instances).flatMap(i=>Object.values(i.monsters||{})).filter(m=>m.type==='phoenix'&&!m.dead).map(m=>{remove_monster(m,{nospawn:true,silent:true});return m.id})`);
    await live.post('/navigate-to-monster',{monsterId:'phoenix',phoenixRouteOrder:order});
    // Declared boundary: the nearest hawk targets the priest once the search starts.
    await expect.poll(async()=>!!(await live.state()).rareHuntState?.patrol?.searchers?.[P],{timeout:120_000,
      message:'The priest must receive a search assignment'}).toBe(true);
    const caught=await live.admin(`output=(()=>{
      const p=Object.values(players).find(p=>p.name===${JSON.stringify(P)});
      const hawk=Object.values(instances.main.monsters).filter(m=>m.type==='bigbird'&&!m.dead)
        .sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];
      if(!hawk)throw Error('No hawk on Mainland');
      target_player(hawk,p);
      return {hawk:String(hawk.id),hawkSpeed:hawk.speed,priestSpeed:p.speed,priest:{x:p.x,y:p.y},distance:Math.hypot(hawk.x-p.x,hawk.y-p.y),at:Date.now()};
    })()`);
    await info.attach('hawk-caught-searcher',{body:JSON.stringify(caught,null,2),contentType:'application/json'});
    expect(caught.priestSpeed,'The fixture needs a priest faster than the hawk').toBeGreaterThan(caught.hawkSpeed);
    const samples:any[]=[];
    const away=async()=>{
      const [s,state]=await Promise.all([world(live),live.state()]);
      const p=s.players[P];
      samples.push({at:Date.now(),priest:{map:p.map,x:Math.round(p.x),y:Math.round(p.y),hp:p.hp},covered:state.rareHuntState?.patrol?.covered?.length||0,
        retry:state.rareHuntState?.patrol?.retryReason||null});
      return p.map!=='main'||Math.hypot(p.x-hawks.x,p.y-hawks.y)>600;
    };
    await expect.poll(away,{timeout:45_000,intervals:[1000],message:'The priest must walk away from the hawk spawn'}).toBe(true);
    await expect.poll(async()=>(await live.state()).rareHuntState?.patrol?.covered?.length||0,{timeout:300_000,intervals:[2000],
      message:'The search must still cover a region'}).toBeGreaterThan(0);
    const hawkHits=(await Promise.all([W,P].map(name=>live.clients[name].events()))).flat()
      .filter((event:any)=>event.event==='hit'&&[W,P].includes(event.data?.hid)&&String(event.data?.id)===caught.hawk);
    await info.attach('hawk-escape-timeline',{body:JSON.stringify({caught,hawkHits:hawkHits.length,samples},null,2),contentType:'application/json'});
    expect(hawkHits.length,'Nobody may stop to fight a hawk the priest can outrun').toBe(0);
  });
});

// Failure 8f: a fight the spotter cannot be part of (the warrior's, on another
// map) must not switch the spotter's converge control off.
test.describe('distant fight while the spotter shadows',()=>{
  test.use({initialPositions:{[P]:{map:'halloween',x:0,y:600},[W]:{map:'main',x:-1180,y:800}}});
  test('The spotter keeps shadowing the Phoenix while another fighter fights on another map',async({live},info)=>{
    test.setTimeout(900_000);
    const samples:any[]=[];
    await live.post('/formation',{leader:W});
    await live.post('/formation',{character:P,follow:true});
    await expect.poll(async()=>(await live.state(true)).monsterChoices?.find((m:any)=>m.id==='phoenix')?.locations?.length,{timeout:120_000}).toBe(5);
    const order=zones((await live.state(true)).monsterChoices,['phoenix']).map(a=>a.id!);
    // Declared fixture: the native Phoenix pinned to Spooky Forest, next to the priest.
    const seeded=await live.admin(`output=(()=>{
      const found=[];for(const instance of Object.values(instances))for(const m of Object.values(instance.monsters||{}))if(m.type==='phoenix'&&!m.dead)found.push(m);
      if(found.length!==1)throw Error('Expected one native Phoenix, found '+found.length);
      const native=found[0],definition=native.map_def,boundaries=definition.boundaries,original=G.monsters.phoenix;
      remove_monster(native,{nospawn:true,silent:true});
      try {
        definition.boundaries=boundaries.filter(b=>b[0]==='halloween');
        G.monsters.phoenix={...original,hp:2000000,attack:1};
        const m=new_monster('halloween',definition,{});
        return {id:m.id,map:m.map,x:m.x,y:m.y};
      } finally {definition.boundaries=boundaries;G.monsters.phoenix=original;}
    })()`);
    await live.post('/navigate-to-monster',{monsterId:'phoenix',phoenixRouteOrder:order});
    await expect.poll(async()=>(await live.state()).rareHuntState?.encounter?.targetId,{timeout:300_000,intervals:[500],
      message:'The priest must spot the seeded Phoenix'}).toBe(seeded.id);
    const first=(await live.state()).rareHuntState.encounter;
    // Declared boundary: a hawk the warrior cannot outrun, with enough HP to keep it
    // fighting, spawned next to it from a modified definition (as the Phoenix is).
    const hawk=await live.admin(`output=(()=>{
      const p=Object.values(players).find(p=>p.name===${JSON.stringify(W)});
      if(!p||p.map!=='main')throw Error('The warrior must still be on Mainland: '+(p&&p.map));
      // A chasing monster moves at its definition's charge speed, recalculated
      // continuously, so this disposable server's hawks charge faster for the rest of the test.
      const fast=Math.max(200,p.speed*2),original=G.monsters.bigbird;
      original.charge=fast;
      try {
        G.monsters.bigbird={...original,speed:fast,hp:2000000};
        const m=new_monster('main',{type:'bigbird',boundary:[p.x-40,p.y-40,p.x+40,p.y+40],count:1},{});
        target_player(m,p);
        return {id:String(m.id),speed:m.speed,warriorSpeed:p.speed,at:Date.now()};
      } finally {G.monsters.bigbird=original;}
    })()`);
    expect(hawk.speed,'The fixture needs an attacker faster than the warrior').toBeGreaterThan(hawk.warriorSpeed);
    await expect.poll(async()=>{
      const [state,s,phoenix]=await Promise.all([live.state(),world(live),
        live.admin(`output=(()=>{const m=Object.values(instances.halloween.monsters).find(m=>m.id===${JSON.stringify(seeded.id)});return m?{x:m.x,y:m.y}:null})()`)]);
      const pr=s.players[P],wa=s.players[W];
      samples.push({at:Date.now(),encounter:state.rareHuntState?.encounter?.id||null,message:state.rareHuntState?.message,
        priest:{map:pr.map,x:Math.round(pr.x),y:Math.round(pr.y),dist:phoenix&&pr.map==='halloween'?Math.round(Math.hypot(pr.x-phoenix.x,pr.y-phoenix.y)):null},
        warrior:{map:wa.map,x:Math.round(wa.x),y:Math.round(wa.y)},fights:(state.characters?.[W]?.groupedCombat?.state?.fights||state.characters?.[W]?.groupedCombat?.fights||[]).map((f:any)=>String(f.id))});
      return Date.now()-hawk.at;
    },{timeout:120_000,intervals:[1000]}).toBeGreaterThan(60_000);
    const fighting=samples.filter(s=>s.fights.includes(hawk.id));
    await info.attach('phoenix-distant-fight',{body:JSON.stringify({seeded,first:first.id,hawk,fightingSamples:fighting.length,samples},null,2),contentType:'application/json'});
    expect(fighting.length,'The fixture needs the warrior in a grouped fight with the hawk').toBeGreaterThan(5);
    expect(samples.every(s=>s.encounter===first.id),'The encounter must survive the warrior\'s distant fight').toBe(true);
    expect(samples.filter(s=>s.priest.map!=='halloween'||s.priest.dist===null||s.priest.dist>600),
      'The priest must keep shadowing the Phoenix').toEqual([]);
  });
});
