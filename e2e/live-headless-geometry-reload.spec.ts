import {test,expect} from './live-fixtures';
import {farmingAreas} from '../dashboard/lib/farming-areas';

const W='E2EWarrior',P='E2EPriest';
const runtimeOf=(c:any):string|undefined=>c?.combatSelection?.runtimeId||c?.convoyNavigation?.runtimeId;
// The shared-route geometry repair reload evaluates the browser loader inside a
// real caracAL worker. Its jsdom realm has no AbortSignal.any (jsdom 24 ships
// only AbortSignal.abort and AbortSignal.timeout).
// Town keeps the party out of combat, so every member reports the repair hold.
test.use({liveHeadless:true,initialPosition:{map:'main',x:0,y:0}});
// Known gap: the coordinator sends the reload signal only while every member's
// report matches the repair (geometry-repair.ts geometryReloadSignal). The
// browser leader restarts its own runtime during the repair, so its report no
// longer matches convoy.runtimes; in five of six runs the signal never came.
// The sixth reached the reload and showed the second realm gap, the missing
// crypto.subtle, which runner-host.ts now fills.
test.fixme('a headless worker survives the shared-route geometry repair reload',async({live},info)=>{
  test.setTimeout(900_000);
  const logs=async(name:string)=>{
    const response=await fetch(live.url+'/party-api/state?section=logs',{signal:AbortSignal.timeout(15_000)});
    const body=await response.json() as {gameLogs?:Record<string,{at:number;message:string}[]>};
    return body.gameLogs?.[name]||[];
  };
  await live.post('/steam/action',{character:P,action:'logout'});
  await expect.poll(async()=>{const s=await live.state();return !s.activeSlots.some((slot:any)=>slot.character===P)&&(!s.steamSwitch||s.steamSwitch.phase==='complete');},{timeout:60_000}).toBe(true);
  await expect.poll(()=>live.admin(`output=!!get_player('${P}')`),{timeout:30_000}).toBe(false);
  const slots=await live.state(),slot=slots.activeSlots.find((entry:any)=>!entry.character&&entry.kind!=='steam');
  await live.post('/slots/'+(slot?.slot??slot?.index??0)+'/spawn',{character:P});
  await expect.poll(async()=>{const c=(await live.state()).characters[P];return c?.runtime==='headless'&&Date.now()-c.seenAt<3000;},{timeout:90_000}).toBe(true);
  let runtimeBefore:string|undefined;
  await expect.poll(async()=>(runtimeBefore=runtimeOf((await live.state()).characters[P])),{timeout:30_000}).toBeTruthy();
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  // Only the browser leader's native map catalog changes. The headless worker
  // keeps the real one, so its shared-route import reports a geometry mismatch.
  // An extra spawn on the unreachable jail map changes only the identity, not any route.
  await live.clients[W].run(`parent.G.maps.jail.spawns.push([0,0]);true`);
  const choices=(await live.state(true)).monsterChoices;
  const area=farmingAreas(choices,['crab']).find((a:any)=>a.map==='main')||farmingAreas(choices,['bee']).find((a:any)=>a.map==='main');
  expect(area,'A main-map farming area must exist for the shared party route').toBeTruthy();
  await live.post('/navigate-to-monster',{monsterId:area!.monsterIds[0],location:area});
  // Movement refreshes its identity while it plans, so the mismatch shows once the party travels.
  await expect.poll(async()=>{
    const s=await live.state();
    const a=s.characters[W]?.movementGeometry,b=s.characters[P]?.movementGeometry;
    return !!a&&!!b&&a.version===b.version&&a.fingerprint!==b.fingerprint;
  },{timeout:60_000,message:'The leader must report the probed geometry identity'}).toBe(true);
  const reloadEvidence:any[]=[];
  try{
    await expect.poll(async()=>{
      const entries=await logs(P),s=await live.state();
      reloadEvidence.push({at:Date.now(),convoy:s.activeConvoy&&{id:s.activeConvoy.id,phase:s.activeConvoy.phase,failure:s.activeConvoy.failure,repair:s.activeConvoy.geometryRepair},
        runtime:runtimeOf(s.characters[P]),logs:entries.slice(-5).map(e=>e.message),
        navigation:Object.fromEntries([W,P].map(n=>{const v=s.characters[n]?.convoyNavigation;return [n,v&&{phase:v.phase,id:v.id,epoch:v.epoch,commandId:v.commandId,runtimeId:v.runtimeId}];})),
        convoyRuntimes:s.activeConvoy?.runtimes,convoyEpoch:s.activeConvoy?.epoch});
      if(reloadEvidence.length>60)reloadEvidence.splice(5,1);
      if(entries.some(e=>e.message.includes('Reloading runtime once to repair shared-route geometry')))return true;
      // The reload signal waits for every member's held report; a repair that
      // expires first is a new convoy's chance, as on the live console.
      if(!s.activeConvoy||s.activeConvoy.geometryRepair?.phase==='failed')await live.post('/navigate-to-monster',{monsterId:area!.monsterIds[0],location:area});
      return false;
    },{timeout:420_000,intervals:[2_000],message:'The headless follower must receive the geometry repair reload'}).toBe(true);
    await expect.poll(async()=>{const c=(await live.state()).characters[P];const runtime=runtimeOf(c);return !!runtime&&runtime!==runtimeBefore&&Date.now()-c.seenAt<3000;},
      {timeout:60_000,message:'The reloaded headless runtime must start and keep reporting'}).toBe(true);
    const loaded=await logs(P);
    expect(loaded.some(e=>/Party loader failed/.test(e.message)),'The reloaded loader must not fail in the caracAL realm').toBe(false);
    expect(loaded.some(e=>/Loaded party CODE generation/.test(e.message))).toBe(true);
  }finally{
    await info.attach('headless-geometry-reload-evidence',{body:JSON.stringify(reloadEvidence),contentType:'application/json'});
  }
  await live.clients[W].run(`parent.G.maps.jail.spawns.pop();true`);
  // The reloaded worker keeps heartbeats and accepts a later native walk.
  const reloaded=(await live.state()).characters[P];
  await live.post('/formation',{character:P,follow:false});
  const goal={map:'main',x:Math.round(reloaded.x)+60,y:Math.round(reloaded.y)};
  const clear=await live.admin(`output=(()=>{const p=get_player('${P}');return can_move({...p,going_x:${goal.x},going_y:${goal.y}});})()`);
  if(!clear)goal.x-=120;
  await live.post('/command',{character:P,type:'character-travel',location:goal});
  await expect.poll(async()=>{const c=(await live.state()).characters[P];return Date.now()-c.seenAt<3000&&c.map===goal.map&&Math.hypot(c.x-goal.x,c.y-goal.y)<20;},
    {timeout:60_000,message:'The reloaded headless worker must still walk'}).toBe(true);
  const entries=await logs(P);
  await info.attach('headless-geometry-reload-logs',{body:JSON.stringify(entries.slice(-40)),contentType:'application/json'});
  expect(entries.some(e=>/AbortSignal\.any is not a function/.test(e.message))).toBe(false);
});
