const test=require('node:test'),assert=require('node:assert/strict');
const{installPartyMovement}=require('../../runtime/characters/movement.ts');
const{createNative}=require('../../tools/game/pathfinder-benchmark/native.cjs');
const{directory}=require('./helpers/installed-game.cjs');
const f=require('./fixtures/cave-native-endpoint-attachment.json');
const n=createNative(directory);n.game.geometry[f.map]=f.geometry;n.game.maps[f.map]=f.mapData;
const walk=(a,b)=>a.map===b.map&&n.context.can_move({map:a.map,x:a.x,y:a.y,going_x:b.x,going_y:b.y,base:f.base});
const ports={game:n.game,walk,door:()=>false,hasKey:()=>false};
const from={map:f.map,in:f.map,...f.from};
const repair=(plot,destination=f.to,start=from,p=ports)=>require('../../runtime/navigation/walking-endpoint.ts').repairWalkingEndpoint(p,start,destination,plot);

test('captured native gather executes a certified corner connector and reaches the exact owned anchor',async()=>{
 assert.equal(walk(f.plot.at(-2),f.to),false);assert.equal(walk(f.to,f.to),true);
 const calls=[],c={name:'P',map:f.map,in:f.map,real_x:f.from.x,real_y:f.from.y,moving:false,speed:79,base:f.base,items:[]};
 const host={character:c,G:n.game,parent:{__partyClientVersion:f.version,socket:new(require('node:events').EventEmitter)()},smart:{},
  smart_move:()=>{Object.assign(host.smart,{moving:true,searching:false,found:false});return Promise.resolve();},
  stop:async()=>{host.smart.moving=false;},smart_move_logic(){},
  start_pathfinding(){Object.assign(host.smart,{searching:true,found:true,plot:f.plot.map(p=>({...p}))});},continue_pathfinding(){},
  can_move:p=>n.context.can_move({...p,base:f.base}),can_walk:()=>true,is_transporting:()=>false,
  can_use:()=>false,is_door_close:()=>false,can_use_door:()=>false,find_npc:()=>null,game_log(){},
  move:async(x,y)=>{const next={map:c.map,x,y};assert.ok(walk({map:c.map,x:c.real_x,y:c.real_y},next));calls.push(next);Object.assign(c,{real_x:x,real_y:y,moving:false});},
 };
 let now=1000;const s=installPartyMovement(host,{now:()=>now,context:()=>({runtime:'captured',revision:1,current:true,paused:false}),request:async()=>assert.fail('native gather must not call remote planner'),diagnostic(){}});
 try{
  const complete=s.move(f.to,undefined,{native:true,arrivalTolerance:1}).then(()=>true,()=>false);
  for(let i=0;i<20;i++){now+=100;host.smart_move_logic();await new Promise(resolve=>setImmediate(resolve));}
  assert.equal(await complete,true,'the former native final attachment must not fail repeatedly');
  assert.equal(c.real_x,f.to.x);assert.equal(c.real_y,f.to.y);assert.ok(calls.length>=2);
  assert.equal(s.last().done,true);
 }finally{s.dispose();}
});

test('captured local attachment retains its prefix and exact goal with native clear legs',()=>{
 const result=repair(f.plot);assert.deepEqual(result.slice(0,2),f.plot.slice(0,2));
 assert.deepEqual(result.at(-1),f.to);assert.ok(result.length>f.plot.length);
 let previous=from;for(const point of result){assert.ok(walk(previous,point));previous=point;}
});

test('endpoint attachment refuses a foreign goal, map, instance or transition',()=>{
 const bad=[f.plot.map((p,i)=>i===2?{...p,x:p.x+1}:p),
  f.plot.map((p,i)=>i===2?{...p,map:'main'}:p),f.plot.map((p,i)=>i===2?{...p,in:'foreign-instance'}:p),
  f.plot.map((p,i)=>i===1?{...p,in:'foreign-instance'}:p),f.plot.map((p,i)=>i===2?{...p,town:true}:p),
  f.plot.map((p,i)=>i===1?{...p,transport:true}:p)];
 for(const plot of bad)assert.deepEqual(repair(plot),plot);
 assert.deepEqual(repair(f.plot,{...f.to,in:'foreign-instance'}),f.plot);
});

test('endpoint attachment refuses long, unsafe or disconnected final legs',()=>{
 const far=[{map:f.map,x:f.to.x-200,y:f.to.y},f.to];assert.deepEqual(repair(far),far);
 const unsafe={map:f.map,x:3368.0333121990607,y:380.24390341423646};
 assert.equal(walk(unsafe,unsafe),false);const bad=[f.plot[0],f.plot[1],unsafe];assert.deepEqual(repair(bad,unsafe),bad);
 const disconnected={...ports,walk:(a,b)=>a.x===b.x&&a.y===b.y&&walk(a,b)};
 assert.deepEqual(repair(f.plot,f.to,from,disconnected),f.plot);
});
