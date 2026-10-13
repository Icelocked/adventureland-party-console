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
test.use({loadout:'combat-follow-range',extraFighter:'mage',initialPositions:starts});
test('planned Sparkbot approach independently routes each fighter into native attack range',async({live},info)=>{
 test.setTimeout(240000);
 await live.post('/merchant/force-stand',{enabled:true});await live.post('/focus',{monsterFocus:[]});
 const samples:any[]=[],events:Record<string,any[]>={};let seed:any;
 await live.admin(`output=(()=>{
  globalThis.__e2eFollowRespawns=[];
  for(let i=monster_respawns.length-1;i>=0;i--)if(monster_respawns[i][0]?.map==='uhills')__e2eFollowRespawns.push(monster_respawns.splice(i,1)[0]);
  for(const m of Object.values(instances.uhills.monsters))remove_monster(m,{method:'disappear',nospawn:true});
  return true;})()`);
 try{
  for(const name of fighters)await live.clients[name].frame.evaluate(()=>{const p=window as any;p.__e2eObserveMoves=true;p.__e2eObservedMoveCount=0;});
  seed=await live.admin(`output=(()=>{
   const original=G.monsters.sparkbot;globalThis.__e2eFollowOriginal=original;G.monsters.sparkbot={...original,stationary:true};
   const m=new_monster('uhills',{type:'sparkbot',count:1,position:[-597,-184],radius:0},{temp:1});
   m.speed=0;m.moving=false;m.target=null;m.hp=m.max_hp=10000000;m.u=true;m.abs=true;m.cid++;
   return {id:String(m.id),x:m.x,y:m.y,map:m.map,at:Date.now()};})()`);
  await expect.poll(async()=>Promise.all(fighters.map(name=>live.clients[name].run(`!!parent.entities[${JSON.stringify(seed.id)}]`))),{timeout:15000}).toEqual([true,true,true]);
  const staging=await Promise.all(fighters.map(name=>live.clients[name].run(`(()=>{
   const c=character,e=parent.entities[${JSON.stringify(seed.id)}],body=v=>({map:v.map,in:v.in,x:v.real_x??v.x,y:v.real_y??v.y,awidth:v.awidth??(v.width||0)/(v.mscale||1),aheight:v.aheight??(v.height||0)/(v.mscale||1)});
   const self=body(c),enemy=body(e),goal={...self,...${JSON.stringify(leaderPoint)}};
   return {name:c.name,range:c.range,position:self,enemy,gap:distance(goal,enemy),safety:Math.min(e.range,Math.max(6,c.range-24))+8,goalClear:can_move({map:c.map,x:goal.x,y:goal.y,going_x:goal.x,going_y:goal.y,base:c.base})};})()`)));
  await info.attach('native-sparkbot-follow-staging',{body:JSON.stringify({starts,seed,staging}),contentType:'application/json'});
  expect(staging.every(v=>v.goalClear)).toBe(true);
  expect(staging.slice(1).every(v=>v.range>=200&&v.gap<v.safety),'Actual native caster boxes and equipment must reproduce the unsafe leader endpoint').toBe(true);
  await live.post('/formation',{leader:W});for(const name of [P,M])await live.post('/formation',{character:name,follow:true});
  await live.post('/focus',{monsterFocus:['sparkbot'],monsterPriorities:{sparkbot:999},monsterSearchRadius:600});
  await live.post('/farming-mode',{character:W,mode:'default'});
  await expect.poll(async()=>{
   const state=await live.state();samples.push({at:Date.now(),roles:fighters.map(name=>({name,x:state.characters[name]?.x,y:state.characters[name]?.y,position:state.characters[name]?.combat?.positioning,recovery:state.characters[name]?.groupedCombat?.formationRecovery}))});
   for(const name of fighters)events[name]=await live.clients[name].events();
   return fighters.every(name=>events[name].some(e=>e.event==='hit'&&e.data?.hid===name&&String(e.data?.id)===seed.id&&e.data?.damage>1&&e.data?.source!=='taunt'));
  },{timeout:90000,message:'All three native roles must recover and damage the declared Sparkbot'}).toBe(true);
  for(const name of [P,M]){
   const firstHit=events[name].find(e=>e.event==='hit'&&e.data?.hid===name&&String(e.data?.id)===seed.id&&e.data?.damage>1&&e.data?.source!=='taunt');
   const ownedMove=events[name].find(e=>e.event==='move-issued'&&e.at<=firstHit.at&&e.motion?.position?.target===seed.id&&
    e.motion.position.mode==='independent-approach'&&e.motion.position.movementOwner==='combat-approach'&&
    e.motion.position.approachId&&e.motion.position.target===seed.id);
   expect(ownedMove,'Caster must independently move under the matching owned approach before its first native damage').toBeTruthy();
   expect(events[name].some(e=>e.event==='player'&&e.data?.id===name&&e.sequence>ownedMove.sequence&&e.at<=firstHit.at&&
    Math.hypot(e.data.x-ownedMove.data.x,e.data.y-ownedMove.data.y)>1),'Actual socket displacement must follow the owned recovery move').toBe(true);
  }
  for(const name of [P,M])expect(events[name].some(e=>e.event==='player'&&e.data?.id===name&&e.data.map==='uhills'&&Math.hypot(e.data.x-starts[name as typeof P|typeof M].x,e.data.y-starts[name as typeof P|typeof M].y)>20)).toBe(true);
  for(const name of fighters){const moves=events[name].filter(e=>e.event==='move-issued');expect(moves.length).toBeGreaterThan(0);expect(moves.every(e=>e.motion?.clear===true)).toBe(true);expect(events[name].some(e=>e.event==='new_map'&&e.data?.name==='jail')).toBe(false);}
 }finally{
  await info.attach('native-sparkbot-follow-result',{body:JSON.stringify({seed,samples,events}),contentType:'application/json'});
  for(const name of fighters)await live.clients[name].frame.evaluate(()=>{(window as any).__e2eObserveMoves=false;}).catch(()=>{});
  await live.admin(`output=(()=>{if(__e2eFollowOriginal)G.monsters.sparkbot=__e2eFollowOriginal;monster_respawns.push(...(__e2eFollowRespawns||[]));return true;})()`);
 }
});
