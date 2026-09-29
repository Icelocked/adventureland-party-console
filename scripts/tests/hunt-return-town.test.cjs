const test=require('node:test'),assert=require('node:assert/strict');
const {recordTownAttempt,observeReturnTown}=require('../../runtime/coordinator/navigation/return-town.ts');
const {createSharedConvoyNavigation,sharedCommand}=require('../../runtime/coordinator/navigation/shared-navigation.ts');
const defense=require('../../runtime/coordinator/navigation/convoy-defense.ts');
const {runtime,settle}=require('./helpers/native-convoy-runtime.cjs');
const {namedFunction}=require('./helpers/named-function.cjs');
const vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('characters/shared.js','utf8'),legacy=require('../convoy-navigation.cjs');

function party(){
 const names=['L','F','P'],c={id:'return',epoch:1,routeVersion:1,routeProtocol:4,continuousReturn:1,returnRouting:true,
  phase:'shared-prepare',purpose:'monster-hunt',nonPreemptible:true,leader:'L',participants:names,completed:[],
  location:{map:'main',x:126,y:-413},rally:{map:'main',x:500,y:1100},slowestSpeed:57,runtimes:{L:'L',F:'F',P:'P'}};
 const p={activeConvoy:c,nextCommandId:1,commands:{},navigationIntents:{},combatLogs:{},monsterHunt:{stage:'returning'},
  statuses:Object.fromEntries(names.map(name=>[name,{name,seenAt:1000,map:'main',in:'main',x:500,y:1100,hp:100,speed:57,server:'USII',
   convoyProtocol:4,huntReturnProtocol:2,returnTownReady:true,combatSelection:{runtimeId:name},groupedCombat:{currentAttackersAt:1000,currentAttackers:[]}}]))};
 for(const name of names){const cmd=p.commands[name]=sharedCommand(p,c,c.phase,name);p.statuses[name].convoyNavigation={
  id:c.id,epoch:c.epoch,commandId:cmd.id,navigationRevision:0,runtimeId:name,phase:'route-ready'};}
 return p;
}
test('the first interrupted Town round selects walking, deduplicates members, and resets only after everyone changes map',()=>{
 const p=party(),c=p.activeConvoy;observeReturnTown(p,c,1000);
 const attempt={round:'1:1:0',map:'main',state:'interrupted',destination:{map:'main',x:0,y:0}};
 for(let round=1;round<=3;round++){
  for(const name of c.participants)p.statuses[name].convoyNavigation.townAttempt={...attempt,round:round+':1:0'};
  observeReturnTown(p,c,1000);observeReturnTown(p,c,1000);
  assert.equal(c.returnTown.interruptions,round);assert.equal(c.returnTown.walking,true);
 }
 assert.deepEqual(JSON.parse(JSON.stringify(p.monsterHunt.returnTown)),c.returnTown);
 c.epoch++;observeReturnTown(p,c,1000);assert.equal(c.returnTown.interruptions,3);
 p.statuses.L.map='winterland';assert.equal(observeReturnTown(p,c,1000),false);
 for(const s of Object.values(p.statuses)){s.map='winterland';s.convoyNavigation.transitionMap='winterland';}
 assert.equal(observeReturnTown(p,c,1000),true);assert.equal(c.disableTown,false);assert.equal(c.returnTown.interruptions,0);
});
test('unavailable Town selects walking without counting a cast; superseded reports cannot add rounds',()=>{
 const p=party(),c=p.activeConvoy;observeReturnTown(p,c,1000);
 recordTownAttempt(c,{round:'1:1:0',map:'main',state:'unavailable',destination:{map:'main',x:0,y:0}},1000);
 assert.equal(c.returnTown.interruptions,0);assert.equal(c.returnTown.walking,true);
 p.statuses.F.convoyNavigation={...p.statuses.F.convoyNavigation,commandId:999,townAttempt:{round:'99',map:'main',state:'interrupted'}};
 observeReturnTown(p,c,1000);assert.equal(c.returnTown.interruptions,0);
});


test('continuous return ignores defense holds from hits instead of stopping for combat and loot',()=>{
 const p=party(),c=p.activeConvoy;p.statuses.F.convoyNavigation.phase='defending';
 assert.equal(defense.step(p,1000,sharedCommand),false);assert.equal(c.phase,'shared-prepare');
 assert.equal(c.loot,undefined);assert.equal(c.epoch,1);
});

test('fresh attackers select walking immediately; stale reports cannot change the route',()=>{
 const p=party(),c=p.activeConvoy;
 p.statuses.F.groupedCombat.currentAttackers=[{id:'tortoise',mtype:'tortoise',map:'main',in:'main',hp:50,target:'F'}];
 observeReturnTown(p,c,5000);assert.equal(c.returnTown.walking,false);
 observeReturnTown(p,c,1000);assert.equal(c.returnTown.walking,true);assert.equal(c.disableTown,true);
 assert.equal(c.returnTown.interruptions,0);assert.equal(defense.step(p,1000,sharedCommand),false);
});
test('walking fallback retains movement ownership under live attackers, but cancellation still wins',()=>{
 const p=party(),c=p.activeConvoy;c.returnTown={map:'main',interruptions:3,walking:true};
 p.statuses.F.groupedCombat.currentAttackers=[{id:'bee',mtype:'bee',map:'main',in:'main',hp:50,target:'F'}];
 assert.equal(defense.step(p,1000,sharedCommand),false);assert.equal(c.phase,'shared-prepare');
 p.navigationIntents.F={revision:1,cancelled:true};
 const engine=createSharedConvoyNavigation(legacy,defense.step);c.routeServer='USII';engine.step(p,1000);
 assert.equal(c.phase,'failed');assert.equal(c.failureCode,'owner-lost');
});
test('real client preparation keeps its route and command when an attacker hits',async()=>{
 const r=runtime(),c=r.context;
 c.currentPartyList=()=>['F'];c.get_entity=()=>({id:'bee',type:'monster',mtype:'bee',target:'F'});
 c.isPassingEncounter=()=>false;c.groupedEntityReport=x=>x;c.joinedEvent=false;c.eventTargetTypes=[];
 vm.runInContext(['returnDepartureDefense','defendPartyHit','interruptConvoyForDefense'].map(n=>namedFunction(source,n)).join('\n'),c);
 const cmd={id:2,convoyId:'test',epoch:7,phase:'shared-prepare',routeVersion:1,continuousReturn:1,purpose:'monster-hunt',nonPreemptible:true,
  navigationRevision:0,leader:'F',rally:{map:'main',x:0,y:0},location:{map:'main',x:120,y:0},slowestSpeed:57};
 const started=await r.start(cmd),handle=c.convoyTraveling;
 c.defendPartyHit({id:'F',hid:'bee'});await settle();
 assert.equal(c.convoyTraveling,handle);assert.equal(handle.commandId,2);assert.notEqual(handle.phase,'defending');
 assert.equal(handle.cancelled,false);assert.equal(handle.defensePaused,undefined);
 c.defendPartyHit({id:'F',hid:'bee'});await settle();assert.equal(c.convoyTraveling,handle);
 await r.cancel();await started.promise;assert.equal(c.convoyTraveling,null);
});


function rallyFixture() {
 const p=party(),c=p.activeConvoy;
 Object.assign(c,{phase:'assemble',returnTownRally:{map:'main',x:0,y:0},rally:{map:'main',x:0,y:0},
  sharedStartedAt:1000,sharedProgressAt:70000,sharedWaitingAt:1000,sharedDistances:{L:100,F:0,P:0},
  returnTown:{map:'main',interruptions:1,walking:true,blockedReadiness:'true:true:true'},disableTown:true});
 for(const s of Object.values(p.statuses)){s.x=0;s.y=0;s.seenAt=71000;s.groupedCombat.currentAttackersAt=71000;}
 p.statuses.L.y=50;p.statuses.L.moving=true;
 return {p,c,engine:createSharedConvoyNavigation(legacy)};
}
test('overnight regression: late Town-rally arrival preserves its marker until the moving leader stops',()=>{
 const {p,c,engine}=rallyFixture();
 engine.step(p,71000);
 assert.equal(c.phase,'assemble');assert.ok(c.returnTownRally);assert.equal(c.sharedWaitingAt,undefined);
 p.statuses.L.moving=false;p.statuses.L.y=0;
 engine.step(p,71200);
 assert.equal(c.phase,'shared-prepare');assert.equal(c.returnTownRally,undefined);
 assert.deepEqual(c.location,{map:'main',x:126,y:-413});assert.equal(c.recoveryAttempts,undefined);
 assert.equal(p.commands.L.phase,'shared-prepare');assert.equal(p.commands.L.disableTown,true);
});
test('leader stuck moving within the rally radius consumes bounded route recovery, not a runtime failure',()=>{
 const {p,c,engine}=rallyFixture();c.sharedDistances.L=50;c.sharedProgressAt=1000;c.recoveryAttempts=1;
 engine.step(p,71000);
 assert.equal(c.phase,'failed');assert.equal(c.failureCode,'route-failed');
 assert.match(c.failure,/leader moving or transporting/);assert.equal(c.retryExhausted,true);
});
test('runtime incompatibility gets a fresh continuous deadline after compatible rally progress',()=>{
 const {p,c,engine}=rallyFixture();engine.step(p,71000);
 p.statuses.F.convoyProtocol=3;
 engine.step(p,71200);assert.equal(c.sharedWaitingAt,71200);assert.equal(c.phase,'assemble');
 for(const s of Object.values(p.statuses)){s.seenAt=101201;s.groupedCombat.currentAttackersAt=101201;}
 engine.step(p,101201);
 assert.equal(c.failureCode,'runtime-lost');assert.match(c.failure,/party runtimes: F/);
});
