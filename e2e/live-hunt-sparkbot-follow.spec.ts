import {test,expect} from './live-fixtures';
import {W,P} from './hunt-interruption-helpers';
const M='E2EBankBoi',fighters=[W,P,M];
// Companion native combat boxes differ from live rendered boxes. The leader is
// 20px nearer the same Sparkbot so the actual native endpoint is unsafe too.
const leaderPoint={x:-447,y:-314};
const starts={
 [W]:{map:'uhills',...leaderPoint},[P]:{map:'uhills',x:-285.34,y:-508.24},
 [M]:{map:'uhills',x:-344.13,y:-437.24},E2EMerchant:{map:'main',x:-63,y:100},
};
test.use({loadout:'combat-follow-range',extraFighter:'mage',initialPositions:starts,initialConsoleHold:true});
const halvingStarts={[W]:{map:'uhills',x:-830,y:-290},[P]:{map:'uhills',x:-830,y:-330},[M]:{map:'uhills',x:-830,y:-310},E2EMerchant:{map:'main',x:-63,y:100}};
for(const scene of [{monster:'sparkbot',halving:false},{monster:'goo',halving:false},{monster:'goo',halving:true}])test.describe(scene.halving?'native arrival sightline repair':scene.monster,()=>{
 const monster=scene.monster,positions=scene.halving?halvingStarts:starts,targetPosition=scene.halving?[-750,-460]:[-597,-184];
 test.use({initialPositions:positions});
 test(scene.halving?'planned Goo approach halves its radius after a blocked native arrival':monster==='sparkbot'?'planned Sparkbot approach independently routes each fighter into native attack range':'planned Goo approach holds every fighter until native range and sight are ready',async({live},info)=>{
 test.setTimeout(240000);
 await expect.poll(async()=>{const state=await live.state();return [...fighters,'E2EMerchant'].every(name=>state.characters[name]?.consoleMaintenance?.id==='native-initial-setup'&&state.characters[name].consoleMaintenance.ready);},{timeout:30000,message:'Every actual native client must acknowledge the prelogin setup hold'}).toBe(true);
 await live.post('/merchant/force-stand',{enabled:true});await live.post('/focus',{monsterFocus:[]});
 const samples:any[]=[],events:Record<string,any[]>={};let seed:any;
 await live.admin(`output=(()=>{
  globalThis.__e2eFollowRespawns=[];
  for(let i=monster_respawns.length-1;i>=0;i--)if(monster_respawns[i][0]?.map==='uhills')__e2eFollowRespawns.push(monster_respawns.splice(i,1)[0]);
  for(const m of Object.values(instances.uhills.monsters))remove_monster(m,{method:'disappear',nospawn:true});
  return true;})()`);
 try{
  for(const name of fighters)await live.clients[name].frame.evaluate(()=>{const p=window as any;p.__e2eObserveMoves=true;p.__e2eObservedMoveCount=0;p.__e2eIndependentObservedAttackCount=0;});
  seed=await live.admin(`output=(()=>{
   const original=G.monsters[${JSON.stringify(monster)}];globalThis.__e2eFollowOriginal=original;G.monsters[${JSON.stringify(monster)}]={...original,stationary:true};
   const m=new_monster('uhills',{type:${JSON.stringify(monster)},count:1,position:${JSON.stringify(targetPosition)},radius:0},{temp:1});
   m.speed=0;m.moving=false;m.target=null;m.hp=m.max_hp=10000000;m.u=true;m.abs=true;m.cid++;
   return {id:String(m.id),x:m.x,y:m.y,map:m.map,at:Date.now()};})()`);
  await expect.poll(async()=>Promise.all(fighters.map(name=>live.clients[name].run(`!!parent.entities[${JSON.stringify(seed.id)}]`))),{timeout:15000}).toEqual([true,true,true]);
  const staging=await Promise.all(fighters.map(name=>live.clients[name].run(`(()=>{
   const c=character,e=parent.entities[${JSON.stringify(seed.id)}],body=v=>({map:v.map,in:v.in,x:v.real_x??v.x,y:v.real_y??v.y,awidth:v.awidth??(v.width||0)/(v.mscale||1),aheight:v.aheight??(v.height||0)/(v.mscale||1)});
   const self=body(c),enemy=body(e),goal={...self,...${JSON.stringify(leaderPoint)}};
   return {name:c.name,range:c.range,position:self,enemy,gap:distance(goal,enemy),safety:Math.min(e.range,Math.max(6,c.range-24))+8,goalClear:can_move({map:c.map,x:goal.x,y:goal.y,going_x:goal.x,going_y:goal.y,base:c.base})};})()`)));
  await info.attach('native-sparkbot-follow-staging',{body:JSON.stringify({starts:positions,seed,staging}),contentType:'application/json'});
  expect(staging.every(v=>v.goalClear)).toBe(true);
  if(monster==='sparkbot')expect(staging.slice(1).every(v=>v.range>=200&&v.gap<v.safety),'Actual native caster boxes and equipment must reproduce the unsafe leader endpoint').toBe(true);
  if(scene.halving){
   const geometry=await live.clients[M].run(`(()=>{const c=character,e=parent.entities[${JSON.stringify(seed.id)}],desired=c.range-3;
    const angle=Math.atan2(c.y-e.y,c.x-e.x),padding=Math.max(0,Math.hypot(c.x-e.x,c.y-e.y)-distance(c,e));
    const atRadius=r=>{const candidates=Array.from({length:16},(_,i)=>({x:e.x+Math.cos(angle+i*Math.PI/8)*(r+padding),y:e.y+Math.sin(angle+i*Math.PI/8)*(r+padding)}))
     .filter(p=>can_move({map:c.map,x:p.x,y:p.y,going_x:p.x,going_y:p.y,base:c.base}))
     .sort((a,b)=>Math.hypot(a.x-c.real_x,a.y-c.real_y)-Math.hypot(b.x-c.real_x,b.y-c.real_y));
     const goal=candidates[0];return {radius:r,goal,sight:goal&&can_move({map:c.map,x:goal.x,y:goal.y,going_x:e.x,going_y:e.y,base:c.base})};};
    return {version:parent.G.version,origin:{x:c.real_x,y:c.real_y},range:c.range,padding,inRange:is_in_range(e),sight:can_move_to(e.x,e.y),first:atRadius(desired),half:atRadius(desired/2)};})()`);
   await info.attach('native-independent-halving-geometry-precondition',{body:JSON.stringify(geometry),contentType:'application/json'});
   expect(geometry.inRange).toBe(true);expect(geometry.sight).toBe(false);expect(geometry.first.goal).toBeTruthy();
   expect(geometry.first.sight).toBe(false);expect(geometry.half.sight).toBe(true);
  }
  await live.post('/formation',{leader:W});for(const name of [P,M])await live.post('/formation',{character:name,follow:true});
  await live.post('/focus',{monsterFocus:[monster],monsterPriorities:{[monster]:999},monsterSearchRadius:600});
  await live.post('/farming-mode',{character:W,mode:'default'});
  await info.attach('native-independent-held-configured-state',{body:JSON.stringify(await live.state()),contentType:'application/json'});
  live.consoleDrainLease(null);
  await expect.poll(async()=>{const state=await live.state();return fighters.every(name=>!state.characters[name]?.consoleMaintenance);},{timeout:15000,message:'The actual ordered host lease release must reach all fighters'}).toBe(true);
  await expect.poll(async()=>{
   const state=await live.state();samples.push({at:Date.now(),roles:fighters.map(name=>({name,x:state.characters[name]?.x,y:state.characters[name]?.y,position:state.characters[name]?.combat?.positioning,recovery:state.characters[name]?.groupedCombat?.formationRecovery}))});
   for(const name of fighters)events[name]=await live.clients[name].events();
   return fighters.every(name=>events[name].some(e=>e.event==='hit'&&e.data?.hid===name&&String(e.data?.id)===seed.id&&e.data?.damage>1&&e.data?.source!=='taunt'));
  },{timeout:90000,message:'All three native roles must recover and damage the declared Sparkbot'}).toBe(true);
  if(monster==='goo'){
   const firstAttack=fighters.flatMap(name=>events[name].filter(e=>e.event==='attack-issued'&&e.data?.id===seed.id || e.event==='offensive-skill-issued'&&(e.data?.ids?.includes(seed.id)||!e.data?.ids?.length&&e.motion?.independent?.target===seed.id))).sort((a,b)=>a.at-b.at)[0];
   expect(firstAttack,'Actual outgoing native attack or hostile skill evidence must exist').toBeTruthy();
   const barrier=firstAttack.motion?.independent;
   expect(barrier?.committed).toBe(true);expect(barrier?.target).toBe(seed.id);
   for(const name of fighters){const ready=barrier?.ready?.[name];
    expect(ready?.selection).toBe(barrier.selection);expect(ready?.target).toBe(seed.id);expect(ready?.ready).toBe(true);
    expect(barrier.serverAt-ready.at).toBeGreaterThanOrEqual(-500);expect(barrier.serverAt-ready.at).toBeLessThanOrEqual(3000);}
   await info.attach('native-independent-all-ready-before-first-attack',{body:JSON.stringify(firstAttack),contentType:'application/json'});
  }
  for(const name of [P,M]){
   const firstHit=events[name].find(e=>e.event==='hit'&&e.data?.hid===name&&String(e.data?.id)===seed.id&&e.data?.damage>1&&e.data?.source!=='taunt');
   const ownedMove=events[name].find(e=>e.event==='move-issued'&&e.at<=firstHit.at&&e.motion?.position?.target===seed.id&&
    e.motion.position.mode==='independent-approach'&&e.motion.position.movementOwner==='combat-approach'&&
    e.motion.position.approachId&&e.motion.position.target===seed.id);
   expect(ownedMove,'Caster must independently move under the matching owned approach before its first native damage').toBeTruthy();
   expect(events[name].some(e=>e.event==='player'&&e.data?.id===name&&e.sequence>ownedMove.sequence&&e.at<=firstHit.at&&
    Math.hypot(e.data.x-ownedMove.data.x,e.data.y-ownedMove.data.y)>1),'Actual socket displacement must follow the owned recovery move').toBe(true);
  }
  if(scene.halving){
   const owned=events[M].filter(e=>e.event==='move-issued'&&e.motion?.position?.target===seed.id&&e.motion.position.movementOwner==='combat-approach');
   const first=owned.find(e=>e.motion.approachGoal?.sight===false);
   expect(first,'A real owned full-radius route with a blocked goal ray must be observed').toBeTruthy();
   const half=owned.find(e=>e.sequence>first.sequence&&Math.abs(e.motion.position.radius-first.motion.position.radius/2)<0.001);
   expect(half,'Actual native movement must resume at half the previous attack radius').toBeTruthy();
   const body=half.motion.parent,goal=first.motion.position.destination;
   expect(Math.hypot(body.real_x-goal.x,body.real_y-goal.y),'Halving must follow actual native arrival at the first owned goal').toBeLessThanOrEqual(3.01);
   await info.attach('native-independent-arrival-radius-halved',{body:JSON.stringify({first,half}),contentType:'application/json'});
  }
  for(const name of [P,M])expect(events[name].some(e=>e.event==='player'&&e.data?.id===name&&e.data.map==='uhills'&&Math.hypot(e.data.x-positions[name as typeof P|typeof M].x,e.data.y-positions[name as typeof P|typeof M].y)>20)).toBe(true);
  for(const name of fighters){const moves=events[name].filter(e=>e.event==='move-issued');expect(moves.length).toBeGreaterThan(0);expect(moves.every(e=>e.motion?.clear===true)).toBe(true);expect(events[name].some(e=>e.event==='new_map'&&e.data?.name==='jail')).toBe(false);}
 }finally{
  live.consoleDrainLease(null);
  await info.attach('native-sparkbot-follow-result',{body:JSON.stringify({seed,samples,events}),contentType:'application/json'});
  for(const name of fighters)await live.clients[name].frame.evaluate(()=>{(window as any).__e2eObserveMoves=false;}).catch(()=>{});
  await live.admin(`output=(()=>{if(__e2eFollowOriginal)G.monsters[${JSON.stringify(monster)}]=__e2eFollowOriginal;monster_respawns.push(...(__e2eFollowRespawns||[]));return true;})()`);
 }
});

});
