const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const fixture=require('./fixtures/halloween-native-interior-edge.json');
const {repairDoorApproaches}=require('../../runtime/navigation/door-approach.ts');
const native=vm.createContext({G:{geometry:{halloween:fixture.geometry},maps:{halloween:fixture.mapData,main:{spawns:[[0,0]],doors:[],npcs:[]}},npcs:{transporter:{places:{}}}},Place:'code',Math,Date});
vm.runInContext(fs.readFileSync(path.join(require('./helpers/installed-game.cjs').directory,'old_common_functions.js'),'utf8'),native);
const walk=(a,b)=>a.map===b.map&&native.can_move({map:a.map,x:a.x,y:a.y,going_x:b.x,going_y:b.y,base:fixture.base});
const ports={game:native.G,walk,door:()=>false,hasKey:()=>false};
const from=fixture.from,to={...fixture.to,method:'move'};
const origin={map:'spookytown',x:34,y:1449},entry={map:'halloween',x:784,y:-1060,transport:true,s:2};

test('native Halloween interior corner retains its exact endpoint through a clear local connector',()=>{
 assert.equal(walk(from,from),true);assert.equal(walk(to,to),true);assert.equal(walk(from,to),false);
 const plot=[entry,{...from},to],fixed=repairDoorApproaches(ports,origin,plot);
 assert.deepEqual(fixed.slice(0,2),plot.slice(0,2));assert.equal(fixed.at(-1),to);
 assert.ok(fixed.length>plot.length);let previous=from;
 for(const point of fixed.slice(2)){assert.equal(walk(previous,point),true,JSON.stringify([previous,point]));previous=point;}
});
test('native-clear walking segments keep exact points and metadata',()=>{
 const plot=[{...to,y:-91}],fixed=repairDoorApproaches(ports,from,plot);
 assert.deepEqual(fixed,plot);assert.equal(fixed[0],plot[0]);
});
test('foreign instance, transition, long and unreachable edges keep their rejection',()=>{
 for(const [origin,goal] of [[{...from,in:'a'},{...to,in:'b'}],[{...from,town:true},to],
  [from,{...to,town:true}],[from,{...to,map:'main'}],[from,{...to,x:1200}]]){
  const plot=[origin,goal];assert.deepEqual(repairDoorApproaches(ports,{map:'spookytown',x:34,y:1449},plot),plot);
 }
 assert.deepEqual(repairDoorApproaches({...ports,walk:()=>false},from,[to]),[to]);
});
test('local walking repair preserves surrounding transport boundaries',()=>{
 const exit={map:'main',x:1471,y:-424,transport:true,s:15};
 const plot=[entry,{...from},to,exit],fixed=repairDoorApproaches(ports,origin,plot);
 assert.equal(fixed[0],entry);assert.equal(fixed.at(-1),exit);assert.equal(fixed.at(-2),to);
 assert.ok(fixed.length>plot.length);
});
