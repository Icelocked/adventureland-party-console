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
  command:(name,command)=>{commands[name]=command;},nextCommand:()=>1};
 return {state,statuses,commands,effects,ports,...createEventObservations(state,ports),
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
 const f=fixture();f.time(40000);f.state.current={event:'franky',cycleId:'r',startedAt:1000,pending:['P','W'],participants:['P','W'],checkpoint:null};
 f.statuses.W={seenAt:40000};f.observe({name:'W'});
 assert.deepEqual(f.state.current.pending,['W']);assert.equal(f.state.deferred.P.phase,'awaiting-reconnect');assert.ok(f.effects.includes('finish'));
});


test('an actual native Halloween target records the assisting follower without a joined flag',()=>{
 const f=fixture();f.statuses.P={seenAt:1000,map:'halloween',in:'halloween',server:'USI'};
 f.observe({name:'P',map:'halloween',in:'halloween',server:'USI',serverLiveEvents:[{name:'mrpumpkin'}],target:{id:'492',type:'monster',mtype:'mrpumpkin',hp:100000}});
 assert.deepEqual(f.state.sessions.P.participants,['P']);
 const globalOnly=fixture();globalOnly.statuses.P={seenAt:1000};globalOnly.observe({name:'P',serverLiveEvents:[{name:'mrpumpkin'}]});
 assert.deepEqual(globalOnly.state.sessions.P.participants,[]);
 for(const invalid of [{status:{seenAt:-20000}},{status:{seenAt:1000,eventFeedConnected:false}},{cancelled:true},
  {target:{id:'492',type:'monster',mtype:'mrpumpkin',hp:0}},{target:{id:'other',type:'monster',mtype:'goo',hp:100}},
  {target:{id:'492',type:'monster',mtype:'mrpumpkin',hp:100,map:'main'}},
  {target:{id:'492',type:'monster',mtype:'mrpumpkin',hp:100,in:'other'}},
  {target:{id:'492',type:'monster',mtype:'mrpumpkin',hp:100,server:'USII'}},{missingMap:true},{clockStale:true}]){
  const rejected=fixture();rejected.statuses.P={map:'halloween',in:'halloween',server:'USI',...(invalid.status||{seenAt:1000})};if(invalid.cancelled)rejected.intent(2,true);
  rejected.observe({name:'P',map:invalid.missingMap?undefined:'halloween',in:'halloween',server:'USI',eventClockStale:!!invalid.clockStale,serverLiveEvents:[{name:'mrpumpkin'}],target:invalid.target||{id:'492',type:'monster',mtype:'mrpumpkin',hp:100000}});
  assert.deepEqual(rejected.state.sessions.P.participants,[]);
 }
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

function retiredSameEvent(){
 const f=fixture();f.time(10000);
 const recovery={event:'mrpumpkin',cycleId:'retired-old',checkpoint:{map:'uhills',x:-550,y:-160},navigationRevision:1,phase:'returning-to-checkpoint'};
 f.state.deferred.W={...recovery};f.state.deferred.P={...recovery};
 f.statuses.W={seenAt:10000,serverLiveEvents:[{name:'mrpumpkin',id:'new-native-round'}],eventFeedConnected:true,eventClockStale:false};
 f.statuses.P={seenAt:1000};
 f.ports.retireDeferredCommand=(name,cycleId)=>{const c=f.commands[name];if(c?.cycleId===cycleId&&['event-return-town','event-resume-travel'].includes(c.type))delete f.commands[name];};
 return f;
}
test('retired same-type live admission waits for actual authorization without recreating the old return',()=>{
 const f=retiredSameEvent();f.observe({name:'W',map:'uhills',x:-550,y:-160,serverLiveEvents:[{name:'mrpumpkin',id:'new-native-round'}]});
 assert.equal(f.commands.W,undefined);assert.ok(f.state.deferred.W);assert.deepEqual(f.state.sessions.W.participants,[]);
 assert.equal(f.authorize('W','mrpumpkin').allowed,true);assert.equal(f.state.deferred.W,undefined);
 assert.deepEqual(f.state.sessions.W.waypoints.W.location,{map:'uhills',x:-550,y:-160});assert.ok(f.state.deferred.P);
});
test('a late fresh same-event report retires only its already-issued obsolete return command',()=>{
 const f=retiredSameEvent();f.commands.W={id:1,type:'event-return-town',cycleId:'retired-old'};
 f.observe({name:'W',serverLiveEvents:[{name:'mrpumpkin'}]});assert.equal(f.commands.W,undefined);assert.ok(f.state.deferred.W);
 const manual=retiredSameEvent();manual.commands.W={id:2,type:'character-travel',cycleId:'manual'};
 manual.observe({name:'W',serverLiveEvents:[{name:'mrpumpkin'}]});assert.equal(manual.commands.W.id,2);assert.ok(manual.state.deferred.W);
});
test('original same-type live event exhausted by attendance limits cannot bypass its old return',()=>{
 const {eventInstanceAllowed}=require('../../runtime/coordinator/events/attendance-limits.ts');
 for(const ignored of ['duration','deaths']){
  const f=retiredSameEvent(),policy={eventAttendance:{W:{mrpumpkin:{ended:false,ignored,elapsedMs:90000}}},leader:'W',followers:{P:true}};
  f.ports.enabled=(name,event)=>event?eventInstanceAllowed(policy,name,event):true;
  f.observe({name:'W',map:'uhills',serverLiveEvents:[{name:'mrpumpkin',id:'original-live-round'}]});
  assert.equal(f.commands.W.type,'event-return-town');assert.equal(f.authorize('W','mrpumpkin').allowed,false);assert.ok(f.state.deferred.W);
 }
});
test('retired same-event entry does not bypass stale clocks, manual intents or active return ownership',()=>{
 for(const variant of ['stale','disconnected','clock','cancelled','revision','disabled','active']){
  const f=retiredSameEvent();
  if(variant==='stale')f.statuses.W.seenAt=6000;
  if(variant==='disconnected')f.statuses.W.eventFeedConnected=false;
  if(variant==='clock')f.statuses.W.eventClockStale=true;
  if(variant==='cancelled')f.intent(1,true);
  if(variant==='revision')f.intent(2);
  if(variant==='disabled')f.ports.enabled=()=>false;
  if(variant==='active')f.state.current={cycleId:'retired-old',event:'mrpumpkin',startedAt:10000,participants:['W'],pending:['W']};
  f.observe({name:'W',map:'uhills',serverLiveEvents:[{name:'mrpumpkin'}]});
  assert.equal(f.commands.W?.type,'event-return-town',variant);assert.ok(f.state.deferred.W,variant);
 }
});

test('eligible same-event admission retires exit phase while preserving checkpoint and stale peer ownership',()=>{
 const f=retiredSameEvent();f.observe({name:'W',serverLiveEvents:[{name:'mrpumpkin'}]});
 assert.equal(f.state.deferred.W.phase,'awaiting-event-admission');assert.equal(f.state.deferred.P.phase,'returning-to-checkpoint');
 assert.deepEqual(f.state.deferred.W.checkpoint,{map:'uhills',x:-550,y:-160});
 f.statuses.W.serverLiveEvents=[];f.observe({name:'W',map:'main',x:0,y:0,serverLiveEvents:[]});
 assert.equal(f.state.deferred.W.phase,'returning-to-checkpoint');assert.equal(f.commands.W.type,'event-resume-travel');
});


test('authorized future Halloween staging survives delayed joined-event reporting',()=>{
 const f=fixture();f.statuses.P={seenAt:1000,server:'USI',eventFeedConnected:true};
 f.authorize('P','mrpumpkin');
 f.observe({name:'P',server:'USI',serverStagingEvents:[{name:'mrpumpkin',spawnAt:50000,spawnId:50000}]});
 f.time(12000);f.statuses.P.seenAt=12000;
 f.observe({name:'P',server:'USI',serverStagingEvents:[{name:'mrpumpkin',spawnAt:50000,spawnId:50000}]});
 assert.equal(f.effects.some(Array.isArray),false,'pre-join transport delay must not retire an authorized future staging round');
 assert.equal(f.state.sessions.P.stagingSpawnId,50000);
 assert.deepEqual(f.state.sessions.P.participants,['P']);
});

for(const invalid of ['unowned','stale','future-status','dead','wrong-event','wrong-realm','missing-realm','disconnected','clock-stale','cancelled','already-live','wrong-participant','unrecorded','incoming-dead','stored-disconnected','stored-clock-stale'])test('pre-join staging cannot extend invalid attendance: '+invalid,()=>{
 const f=fixture();f.statuses.P={seenAt:1000,server:'USI',eventFeedConnected:true};
 if(invalid!=='unowned')f.authorize('P','mrpumpkin');
 if(invalid==='already-live')f.observe({name:'P',serverLiveEvents:[{name:'mrpumpkin'}]});
 f.time(12000);f.statuses.P.seenAt=invalid==='stale'?1000:invalid==='future-status'?13000:12000;
 if(invalid==='dead')f.statuses.P.rip=true;
 if(invalid==='wrong-participant')f.state.sessions.P.participants=['W'];
 if(invalid==='unrecorded')f.state.sessions.P.participationRecorded=false;
 if(invalid==='stored-disconnected')f.statuses.P.eventFeedConnected=false;
 if(invalid==='stored-clock-stale')f.statuses.P.eventClockStale=true;
 if(invalid==='cancelled')f.intent(1,true);
 f.observe({name:'P',rip:invalid==='incoming-dead',server:invalid==='missing-realm'?undefined:invalid==='wrong-realm'?'USII':'USI',
  eventFeedConnected:invalid==='disconnected'?false:true,eventClockStale:invalid==='clock-stale',
  serverStagingEvents:[{name:invalid==='wrong-event'?'mrgreen':'mrpumpkin',spawnAt:50000,spawnId:50000}]});
 assert.equal(f.state.sessions.P?.stagingSpawnId,undefined);
 if(invalid==='unowned')assert.equal(f.state.sessions.P,undefined);
});
