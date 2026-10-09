const test=require('node:test');
const assert=require('node:assert/strict');
const {createEventObservations}=require('../../runtime/coordinator/events/observations.ts');
function fixture(){
 const state={sessions:{},current:null,deferred:{},anniversary:{eventCycle:null,returnReady:{},returnDestination:null,partyHold:null}};
 const statuses={},commands={},effects=[];let now=1000,revision=1,cancelled=false,fighting=false;
 const ports={now:()=>now,activeNames:()=>['P','W'],merchant:()=> 'M',enabled:()=>true,checkpoint:()=>({map:'cave',x:1,y:2}),
  capture:()=>({}),persist:()=>effects.push('persist'),log:message=>effects.push(message),statuses:()=>statuses,
  goobrawlStillFighting:()=>fighting,begin:(event,session)=>effects.push(['return',event,session.participants]),finishIfReady:()=>effects.push('finish'),
  location:recovery=>recovery.checkpoint,intent:()=>({revision,cancelled}),hasCommand:name=>!!commands[name],
  command:(name,command)=>{commands[name]=command;},nextCommand:()=>1,
  retireCommand:(name,cycleId)=>{if(commands[name]?.cycleId!==cycleId)return false;delete commands[name];return true;}};
 return {state,statuses,commands,effects,...createEventObservations(state,ports),
  time:value=>{now=value;},intent:(value,cleared=false)=>{revision=value;cancelled=cleared;},fighting:value=>{fighting=value;}};
}
test('stale kiss completion cannot erase a newer kiss, and cancelled movement cannot join combat',()=>{
 const f=fixture();f.state.anniversary.eventCycle={endsAt:100000,kissOperations:{}};
 f.authorize('P','anniversary',{id:'new',phase:'begin'});
 f.authorize('P','anniversary',{id:'old',phase:'end'});
 assert.equal(f.state.anniversary.eventCycle.kissOperations.P.id,'new');
 f.intent(2,true);assert.equal(f.authorize('P','crabxx').allowed,false);assert.equal(f.state.sessions.P,undefined);
});

test('raw event reports retain captured participants and derived hints cannot keep an event alive',()=>{
 const f=fixture();f.authorize('P','franky');f.authorize('W','franky');f.observe({name:'P',serverLiveEvents:[{name:'franky',id:'round'}]});
 const original=f.state.sessions.P;f.time(2000);f.observe({name:'P',serverLiveEvents:[{name:'franky'}]});
 assert.equal(f.state.sessions.P.id,'round');assert.equal(f.state.sessions.P.waypoints,original.waypoints);
 f.time(12000);f.observe({name:'P',activeEvent:'franky'});
 assert.deepEqual(f.effects.find(Array.isArray),['return','franky',['P','W']]);assert.deepEqual(f.state.sessions,{});
});
test('Goo Brawl combat postpones recovery even after the server announcement expires',()=>{
 const f=fixture();f.authorize('P','goobrawl');f.authorize('W','goobrawl');f.observe({name:'P',serverLiveEvents:[{name:'goobrawl'}]});f.time(20000);f.fighting(true);
 f.observe({name:'P'});assert.ok(f.state.sessions.P);assert.equal(f.effects.some(Array.isArray),false);
 f.fighting(false);f.observe({name:'P'});assert.deepEqual(f.effects.find(Array.isArray),['return','goobrawl',['P','W']]);
});
test('a cleared navigation intent prevents reconnect recovery from restoring an old checkpoint',()=>{
 const f=fixture();f.state.deferred.P={event:'franky',cycleId:'r',checkpoint:{map:'cave',x:1,y:2},navigationRevision:1,phase:'awaiting-reconnect'};
 f.intent(2,true);f.observe({name:'P',map:'main',x:0,y:0});
 assert.equal(f.state.deferred.P,undefined);assert.equal(f.commands.P,undefined);
});
test('stale return participant is deferred without holding up healthy party members',()=>{
 const f=fixture();f.time(40000);f.state.current={event:'franky',cycleId:'r',startedAt:1000,pending:['P','W'],checkpoint:null};
 f.statuses.W={seenAt:40000};f.observe({name:'W'});
 assert.deepEqual(f.state.current.pending,['W']);assert.equal(f.state.deferred.P.phase,'awaiting-reconnect');assert.ok(f.effects.includes('finish'));
});


test('observed Gigacrab without departure never starts event recovery',()=>{
 const f=fixture(); f.observe({name:'P',serverLiveEvents:[{name:'crabxx'}]});
 f.time(12000);f.observe({name:'P'});
 assert.equal(f.effects.some(Array.isArray),false);assert.deepEqual(f.state.sessions,{});
});
test('authorized departure recovers even when the character never joined',()=>{
 const f=fixture();f.observe({name:'P',serverLiveEvents:[{name:'crabxx'}]});f.authorize('W','crabxx');
 f.time(12000);f.observe({name:'P'});
 assert.deepEqual(f.effects.find(Array.isArray),['return','crabxx',['W']]);
});
test('combat handoff waits for registered kiss, rejects new attempts, and retains origin',()=>{
 const f=fixture(),waypoints={P:{revision:1,location:{map:'arena',x:384,y:-420}}};
 const c=f.state.anniversary.eventCycle={id:'round',endsAt:999999,waypoints};
 assert.equal(f.authorize('P','anniversary',{id:'one',phase:'begin'}).allowed,true);
 assert.equal(f.authorize('W','crabxx').allowed,false);
 assert.equal(f.authorize('W','anniversary',{id:'two',phase:'begin'}).allowed,false);
 f.authorize('P','anniversary',{id:'old',phase:'end'});
 assert.equal(f.authorize('W','crabxx').allowed,false);
 f.authorize('P','anniversary',{id:'one',phase:'end'});
 assert.equal(f.authorize('W','crabxx').allowed,true);
 const at=c.combatHandoffAt; f.time(2000);f.authorize('W','crabxx');
 assert.equal(c.combatHandoffAt,at);assert.equal(f.state.sessions.W.waypoints,waypoints);
 assert.equal(f.authorize('P','anniversary').allowed,false);
});
test('a lost kiss operation expires and no longer blocks departure',()=>{
 const f=fixture(); f.state.anniversary.eventCycle={id:'round',endsAt:999999};
 f.authorize('P','anniversary',{id:'one',phase:'begin'});f.time(182000);
 assert.equal(f.authorize('W','crabxx').allowed,true);
});


test('merchant departures and joined reports participate in the normal event return',()=>{
 const f=fixture();assert.equal(f.authorize('M','snowman').allowed,true);
 assert.deepEqual(f.state.sessions.M.participants,['M']);
 f.time(12000);f.observe({name:'M'});
 assert.deepEqual(f.effects.find(Array.isArray),['return','snowman',['M']]);
 const g=fixture();g.observe({name:'M',joinedEvent:'goobrawl',serverLiveEvents:[{name:'goobrawl'}]});
 assert.deepEqual(g.state.sessions.M.participants,['M']);
});

// Failure inventory: e2e/event-follow-leader-failures.md (entries 8–11). Live, a return
// held a member whose other selected event was live: the return refused its event travel
// and the live event blocked its walk home, so it could do neither.
function openReturn(f,participants){
 f.state.current={event:'mrgreen',cycleId:'r',startedAt:1000,pending:[...participants],participants:[...participants],checkpoint:null,
  returnDispatchedAt:900,returnRoutes:Object.fromEntries(participants.map(name=>[name,{location:{map:'main',x:1,y:2},revision:1}]))};
}
test('an open return releases a member whose other selected event is live and finishes when empty',()=>{
 const f=fixture();f.time(20000);openReturn(f,['W']);f.commands.W={id:7,type:'event-return-town',cycleId:'r'};
 f.statuses.W={seenAt:20000,serverLiveEvents:[{name:'mrgreen'},{name:'mrpumpkin'}]};
 f.observe({name:'W',serverLiveEvents:[{name:'mrgreen'},{name:'mrpumpkin'}]});
 assert.deepEqual(f.state.current.participants,[]);assert.deepEqual(f.state.current.pending,[]);
 assert.equal(f.state.current.returnRoutes,null);assert.equal(f.state.current.returnDispatchedAt,null);assert.ok(f.effects.includes('finish'));
 assert.equal(f.commands.W,undefined,'its return command is retired, not retried against a superseded cycle');
});
test('an open return keeps members with no other live event, and stale reports release nobody',()=>{
 const f=fixture();f.time(20000);openReturn(f,['P','W']);f.commands.P={id:8,type:'event-return-town',cycleId:'r'};
 f.statuses.P={seenAt:20000,serverLiveEvents:[{name:'mrgreen'}]};
 f.statuses.W={seenAt:5000,serverLiveEvents:[{name:'mrpumpkin'}]};
 f.observe({name:'P',serverLiveEvents:[{name:'mrgreen'}]});
 assert.deepEqual(f.state.current.participants,['P','W']);assert.ok(f.state.current.returnRoutes.W);assert.ok(f.commands.P);
});
test('a new return leaves out a member whose other selected event is live',()=>{
 const f=fixture();f.authorize('P','mrgreen');f.authorize('W','mrgreen');
 f.time(20000);f.statuses.W={seenAt:20000,serverLiveEvents:[{name:'mrpumpkin'}]};
 f.observe({name:'P'});
 assert.deepEqual(f.effects.find(Array.isArray),['return','mrgreen',['P']]);
});
