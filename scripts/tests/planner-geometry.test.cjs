const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { loadPlannerGeometry } = require('../../runtime/coordinator/navigation/planner-geometry.ts');
const { geometryFingerprint } = require('../../runtime/navigation/contracts.ts');
const { createPlannerService } = require('../../runtime/coordinator/navigation/planner-service.ts');
const { validateRoute } = require('../../runtime/navigation/validation.ts');
const { createNative } = require('../../tools/game/pathfinder-benchmark/native.cjs');

test('planner initialization executes client preprocessing before returning geometry', () => {
  const game = loadPlannerGeometry('var G={maps:{main:{spawns:[[0,0]]}},geometry:{main:{x_lines:[],y_lines:[]}},npcs:{}};',
    'function process_game_data(){if(Place!=="client")throw Error("wrong context");G.geometry.main.x_lines.push([10,20,30]);G.maps.main.data=G.geometry.main;}');
  assert.equal(JSON.stringify(game.geometry.main.x_lines), '[[10,20,30]]');
  assert.equal(game.maps.main.data, game.geometry.main);
});
test('preprocessing failure never silently returns raw geometry', () => {
  assert.throws(() => loadPlannerGeometry('var G={};', 'function process_game_data(){throw Error("bad data");}'), /bad data/);
  assert.throws(() => loadPlannerGeometry('var G={};', ''), /process_game_data/);
});

const directory = path.resolve('.caracal/game_files/17083');
test('game 17083 fixture collisions match the live fingerprint and the reported route plans successfully',
  { skip: !fs.existsSync(path.join(directory, 'data.js')) }, async () => {
    const source = fs.readFileSync(path.join(directory, 'data.js'), 'utf8');
    const game = loadPlannerGeometry(source, fs.readFileSync(path.join(directory, 'old_common_functions.js'), 'utf8'));
    const raw = {}; vm.runInNewContext(source, raw);
    assert.notEqual(geometryFingerprint(raw.G), geometryFingerprint(game));
    assert.equal(geometryFingerprint(game), '65911a4d-e2f70215-218667');
    assert.equal(game.geometry.main.x_lines.length - raw.G.geometry.main.x_lines.length, 4);
    assert.equal(game.geometry.main.y_lines.length - raw.G.geometry.main.y_lines.length, 4);
    const native = createNative(directory), service = createPlannerService(path.resolve('.build/runtime/movement-planner.cjs'));
    try {
      const prepared = service.prepare(game, 17083); await prepared.ready;
      assert.equal(prepared.fingerprint, geometryFingerprint(native.game));
      const from = { map: 'main', x: -1184, y: 232 }, to = { map: 'main', x: -1184, y: 61.8 };
      const request = { id: 'reported-route', version: 17083, fingerprint: prepared.fingerprint, from, to, town: true, speed: 60 };
      const result = await service.plan(request);
      assert.ok(result.plot.length);
      assert.equal(validateRoute({ game: native.game, walk: (a,b) => native.canWalk(a,b),
        door: (p,d) => native.context.is_door_close(p.map,d,p.x,p.y) && native.context.can_use_door(p.map,d,p.x,p.y), hasKey: () => false }, from, to, result.plot, true), null);
      await assert.rejects(service.plan({ ...request, id: 'raw', fingerprint: geometryFingerprint(raw.G) }), /requested.*retained/);
    } finally { service.dispose(); }
});
test('installed Halloween shortcut and ordinary Cyberland recovery validate',()=>{
 const {prepare,getPath}=require('../../runtime/coordinator/navigation/alclient-adapter.ts');
 const native=createNative(require('./helpers/installed-game.cjs').directory);prepare(native.game);
 const ports={game:native.game,walk:(a,b)=>native.canWalk(a,b),door:(p,d)=>native.context.is_door_close(p.map,d,p.x,p.y)&&native.context.can_use_door(p.map,d,p.x,p.y),hasKey:()=>false};
 const to={map:'main',x:0,y:0};
 for(const [from,avoidLeave] of [[{map:'halloween',x:8,y:631},false],[{map:'halloween',x:8,y:631},true],[{map:'cyberland',x:0,y:0},true]]) {
  const plot=getPath({from,to,town:true,speed:60,avoidLeave});
  assert.equal(plot.some(p=>p.method==='leave'),!avoidLeave);
  assert.equal(validateRoute(ports,from,to,plot,true),null);
 }
});

test('reported Winterland return includes a reachable transporter approach in both route candidates',()=>{
 const {prepare,getPath}=require('../../runtime/coordinator/navigation/alclient-adapter.ts');
 const {repairDoorApproaches}=require('../../runtime/navigation/door-approach.ts');
 const native=createNative(require('./helpers/installed-game.cjs').directory);prepare(native.game);
 const ports={game:native.game,walk:(a,b)=>native.canWalk(a,b),door:(p,d)=>native.context.is_door_close(p.map,d,p.x,p.y)&&native.context.can_use_door(p.map,d,p.x,p.y),hasKey:()=>false};
 const from={map:'winterland',x:797,y:-874},to={map:'main',x:126,y:-413};
 for(const town of [false,true]){
  const plot=repairDoorApproaches(ports,from,getPath({from,to,town,speed:57}));
  assert.equal(validateRoute(ports,from,to,plot,town),null);
  const i=plot.findIndex(p=>p.transport&&p.map==='main');assert.ok(i>0);
  assert.ok(Math.hypot(plot[i-1].x+73,plot[i-1].y+393)<75);
 }
});


test('actual planner worker and HTTP preserve verified unreachable identity separately from unavailable geometry',async()=>{
 const {buildSync}=require('esbuild');const {installMovementRoutes}=require('../../runtime/coordinator/http/movement.ts');
 const output=path.resolve('.build/no-route-test-worker.cjs');fs.mkdirSync(path.dirname(output),{recursive:true});
 buildSync({entryPoints:['runtime/coordinator/navigation/planner-worker.ts'],outfile:output,bundle:true,external:['alpathfinder'],format:'cjs',platform:'node',target:'node22'});
 const native=createNative(require('./helpers/installed-game.cjs').directory),service=createPlannerService(output);
 try{
  native.game.maps.unprepared={...native.game.maps.main};
  native.game.geometry.unprepared=native.game.geometry.main;
  const prepared=service.prepare(native.game,17665);await prepared.ready;
  const body={id:'captured-hawk',character:'P',from:{map:'main',in:'main',x:1437.5,y:-445.5},to:{map:'main',in:'main',x:1404.8464,y:55.7972},speed:75,town:false,version:17665,fingerprint:prepared.fingerprint};
  await assert.rejects(service.plan({...body,id:'direct-rejection'}),error=>{
   assert.equal(error.result.failure,'unreachable');assert.equal(error.result.id,'direct-rejection');
   assert.equal(error.result.version,body.version);assert.equal(error.result.fingerprint,body.fingerprint);return true;
  });
  let route;installMovementRoutes({post:(url,handler)=>{if(url==='/party-api/movement-plan')route=handler;}},service,()=>true);
  let reply;const response={json:value=>reply=value,status:()=>response};await route({body},response);
  assert.equal(reply.failure,'unreachable');assert.equal(reply.id,body.id);assert.equal(reply.version,body.version);assert.equal(reply.fingerprint,body.fingerprint);assert.equal(reply.mode,'alclient');assert.deepEqual(reply.plot,[]);
  await route({body:{...body,id:'excluded-map',from:{...body.from,map:'unprepared',in:'unprepared'},to:{...body.to,map:'unprepared',in:'unprepared'}}},response);
  assert.equal(reply.failure,undefined,'An excluded graph cannot certify no route');assert.ok(reply.error);
  await route({body:{...body,id:'special-instance',from:{...body.from,in:'special'},to:{...body.to,in:'special'}}},response);
  assert.equal(reply.failure,undefined,'Static geometry cannot certify a special instance no route');assert.ok(reply.error);
  await route({body:{...body,id:'incompatible',fingerprint:'missing'}},response);assert.equal(reply.failure,undefined);assert.match(reply.error,/compatible/);
  const path=await service.plan({...body,id:'normal',from:{map:'main',x:0,y:0},to:{map:'main',x:100,y:0}});assert.ok(path.plot.length);assert.equal(path.failure,undefined);
 }finally{service.dispose();fs.unlinkSync(output);}
});
