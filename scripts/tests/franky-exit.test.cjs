const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = require('./helpers/coordinator-source.cjs').coordinatorSource();
function fixture() {
  const recovery = {event:'franky', cycleId:'return', pending:['A','B','C']};
  const party = {leader:'A', followers:{B:true,C:true}, statuses:{}, commands:{}, nextCommandId:1,
    navigationEpoch:0, location:{map:'cave',x:20,y:30}, eventReturn:recovery};
  for(const name of recovery.pending) party.statuses[name] = {map:name==='A'?'main':'level2w',x:10,y:20,speed:60,seenAt:Date.now(),server:'I'};
  const context = vm.createContext({farmZones: require('../../.build/shared/farming-zones.cjs'), party, Date, Number, Math, Set, Array,
    farmingNavigation:{intent:()=>({cancelled:true})}, activeNames:()=>['A','B','C'], persistSettings:()=>{},
    cancelActiveConvoy:()=>{for(const name of party.activeConvoy?.participants || []) delete party.commands[name]; party.activeConvoy=null;}});
  Object.assign(context,require('./helpers/coordinator-convoys.cjs').convoyService(context));
  Object.assign(context, require('./helpers/coordinator-events.cjs').eventService(context));
  return {context,party,recovery};
}
test('exit assembles only remote members, even with cleared farming focus, preserving farm location',()=>{
  const {context,party,recovery}=fixture(); const location=party.location;
  assert.equal(context.startFrankyExitConvoy(recovery),true);
  assert.deepEqual(Array.from(party.activeConvoy.participants),['B','C']);
  assert.equal(party.activeConvoy.leader,'B');
  assert.equal(party.activeConvoy.rally.map,'level2w');
  assert.equal(party.location,location);
  assert.equal(party.commands.B.navigationExempt,true);
  assert.equal(party.activeConvoy.combatHandoffAllowed,false);
  assert.equal(context.startFrankyExitConvoy(recovery),false);
});
test('completed exits cannot restart from stale position heartbeats',()=>{
  const {context,recovery}=fixture(); recovery.exited=['B','C'];
  assert.equal(context.startFrankyExitConvoy(recovery),false);
});
test('failed exit rebuilds using remaining remote participants',()=>{
  const {context,party,recovery}=fixture(); context.startFrankyExitConvoy(recovery);
  const first=party.activeConvoy.id; party.activeConvoy.phase='failed'; recovery.exited=['B'];
  assert.equal(context.startFrankyExitConvoy(recovery),true);
  assert.notEqual(party.activeConvoy.id,first);
  assert.deepEqual(Array.from(party.activeConvoy.participants),['C']);
});
for(const code of ['town-unavailable','town-interrupted','communication-timeout','owner-lost'])test('Franky retry distinguishes '+code+' within its owned cycle',()=>{
 const {context,party,recovery}=fixture();context.startFrankyExitConvoy(recovery);
 Object.assign(party.activeConvoy,{phase:'failed',failureCode:code});
 context.startFrankyExitConvoy(recovery);
 const walking=['town-unavailable','town-interrupted'].includes(code);
 assert.equal(!!party.activeConvoy.disableTown,walking);assert.equal(party.activeConvoy.townFirst,!walking);
 recovery.exitTownFallback={cycleId:'old-cycle',participants:['B','C']};party.activeConvoy.phase='failed';party.activeConvoy.failureCode='communication-timeout';
 context.startFrankyExitConvoy(recovery);assert.equal(!!party.activeConvoy.disableTown,false);
});
test('legacy exit completion queues Town for that member before the rest arrive',()=>{
  const {context,party,recovery}=fixture(); context.startFrankyExitConvoy(recovery);
  party.activeConvoy.routeProtocol=2;
  party.activeConvoy.phase='travel'; party.activeConvoy.departAt=0;
  let handler;
  context.express_inst={post:(url,fn)=>{handler=fn;}};
  context.ownedCharacter=()=>true;
  context.convoyNavigation={validReport:()=>true};
  handler=require('./helpers/coordinator-convoy-routes.cjs').convoyRoutes(context)['convoy-complete'];
  handler({body:{character:'B'}},{json:()=>{}});
  assert.equal(party.commands.B.type,'event-return-town');
  assert.equal(party.commands.B.cycleId,recovery.cycleId);
  assert.ok(recovery.exited.includes('B'));
  assert.ok(party.activeConvoy);
});


test('a newer anniversary hold suspends exit convoy rebuilding',()=>{
  const {context,recovery}=fixture(); recovery.exitSuspended=true;
  assert.equal(context.startFrankyExitConvoy(recovery),false);
});
