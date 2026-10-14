const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createIndependentApproachClient}=require('../../runtime/combat/independent-approach-client.ts');
function fixture(){const ctx={allowed:true,planned:true,key:'USII:uhills:target',target:'target',point:{x:100,y:100},radius:200,selection:'s1',committed:false};let owner=null,throwing=false,ready=false,buffered=true,now=10000,clear=true;
 const routes=[];const client=createIndependentApproachClient({context:()=>ctx,now:()=>now,ready:()=>ready,buffered:()=>buffered,clear:()=>clear,goal:(p,r)=>({x:p.x-r,y:p.y}),
  start:(goal,id,direct)=>{if(throwing)throw Error('native start rejected');owner=id;return new Promise((resolve,reject)=>routes.push({goal,id,direct,resolve,reject}));},
  owned:id=>owner===id,cancel:id=>{if(owner===id)owner=null;},position:()=>{}});
 return {client,routes,ctx,get owner(){return owner;},set throwing(v){throwing=v;},set ready(v){ready=v;},set buffered(v){buffered=v;},set now(v){now=v;},set clear(v){clear=v;}};}
test('late caster begins own route after shared target engagement',()=>{const f=fixture();f.ctx.planned=false;assert.equal(f.client.tick(),true);assert.equal(f.routes.length,1);assert.equal(f.client.report().target,'target');});
test('synchronous native start rejection becomes bounded approach failure',()=>{const f=fixture();f.throwing=true;assert.doesNotThrow(()=>f.client.tick());for(let i=0;i<12;i++){f.now=10000+(i+1)*250;assert.doesNotThrow(()=>f.client.tick());}assert.equal(f.client.report().phase,'unreachable');assert.ok(f.client.report().level<=8);});
test('old native completion cannot settle newer owned route',async()=>{const f=fixture();f.client.tick();const first=f.routes[0];f.ctx.point={x:130,y:100};f.now=10250;f.client.tick();const second=f.routes[1];first.resolve();await Promise.resolve();assert.equal(f.client.report().pending,true);assert.equal(f.owner,second.id);assert.equal(f.client.report().id,second.id);});
test('actual role movement entry starts independent event approach',()=>{
 const source=fs.readFileSync('characters/shared.js','utf8'),start=source.indexOf('  function formationMove(target)'),end=source.indexOf('  function solveFormationMove(',start);
 const c=vm.createContext({character:{cave:null},independentApproachReference:null,root:{partyCombatPosition:null,partyQueueClient:{independent:{report:()=>null,movement(){c.root.partyCombatPosition={movementOwner:'combat-approach',target:'boss'};return true;}},formation:{movement(){c.root.partyCombatPosition={movementOwner:'legacy-group'};return true;}}}}});
 vm.runInContext(source.slice(start,end),c);assert.equal(c.formationMove({id:'boss'}),true);assert.equal(c.root.partyCombatPosition.movementOwner,'combat-approach');assert.equal(c.independentApproachReference.target.id,'boss');
});

test('capable split casters enter actor route instead of old healing-anchor regroup',()=>{
 const source=fs.readFileSync('characters/shared.js','utf8'),start=source.indexOf('  function groupedMovement()'),end=source.indexOf('  function leaderLockAllows(',start);
 const target={id:'boss',map:'uhills',in:'uhills',server:'USII',state:'planned'};
 const c=vm.createContext({Date,character:{name:'P',map:'uhills',in:'uhills',x:310,y:0,rip:false},navigationIntent:{cancelled:false,revision:1},convoyTraveling:null,partyConvoyActive:false,
  groupedCombat:{key:'k',independentApproach:true,target,fights:[],blockers:[],recovering:[],range:207,anchor:{name:'W',map:'uhills',in:'uhills',server:'USII',x:0,y:0}},groupRegroup:{key:'k:1',route:{},progressAt:Date.now()},
  encounterCatchup:()=>false,groupedDefensiveTarget:()=>null,groupedFarming:()=>true,groupedFresh:()=>true,groupedCovered:()=>false,groupedAnchorVisible:()=>false,reunionRealm:()=> 'USII',passiveRareCandidate:()=>false,
  cancelGroupRoute:()=>{},cancelFightRoute:()=>{},cancelFarmApproach:()=>{},logGroupMovement:()=>{},get_entity:()=>target,get_player:()=>null,smart:{on_done:undefined},
  root:{sharedRoutine:{isOccupied:()=>false,defensiveFormationMove:()=>false},partyCombatPosition:null,partyQueueClient:{formation:{movement:()=>false},independent:{report:()=>null,movement(){c.root.partyCombatPosition={movementOwner:'combat-approach',target:'boss'};return true;}}}}});
 vm.runInContext(source.slice(start,end),c);assert.equal(c.groupedMovement(),true);assert.equal(c.root.partyCombatPosition.movementOwner,'combat-approach');
});

test('blocked sightline inside weapon range reports active approach for existing pursuit recovery',()=>{
 const source=fs.readFileSync('characters/shared.js','utf8'),start=source.indexOf('  function groupedApproachReport()'),end=source.indexOf('  function groupedNomination(',start);
 const c=vm.createContext({Date,character:{x:0,y:0,range:200,rip:false},coordinatorClockOffset:0,approachObservation:null,formationState:{recovery:null},kiteState:{},partyConvoyActive:false,convoyTraveling:false,eventTraveling:false,joinedEvent:null,navigationIntent:{cancelled:false},
  groupedCombat:{target:{id:'boss',server:'USII',map:'uhills',in:'uhills'},recovering:[]},groupedFresh:()=>true,combatDistance:()=>20,can_move_to:()=>false,get_entity:()=>({visible:true,dead:false}),
  root:{partyCombatPosition:{target:'boss',mode:'independent-approach'},sharedRoutine:{isOccupied:()=>false},partyQueueClient:{independent:{report:()=>({target:'boss',id:'combat-approach:1',phase:'unreachable',goal:{x:10,y:10}})}}}});
 vm.runInContext(source.slice(start,end),c);const report=c.groupedApproachReport();assert.equal(report.active,true);assert.equal(report.intent,'approach');assert.equal(report.deficit,0);assert.equal(report.waypoint.key,'combat-approach:1');
});

test('early native-ready actor holds position while another participant has not committed readiness',()=>{const f=fixture();f.ready=true;assert.equal(f.client.tick(),true);assert.equal(f.routes.length,0);assert.equal(f.client.report().phase,'ready');assert.equal(f.client.readiness().ready,true);f.ctx.committed=true;assert.equal(f.client.tick(),false);assert.equal(f.routes.length,0);});
test('readiness rejects stale ownership and changed selected target',()=>{const f=fixture();f.client.tick();f.ready=true;f.ctx.selection='s2';f.ctx.key='new-selection';assert.equal(f.client.readiness().ready,false);f.ctx.allowed=false;assert.equal(f.client.readiness(),undefined);});

function snapshotPorts(){
 const source=fs.readFileSync('characters/shared.js','utf8'),start=source.indexOf('  function independentApproachOwnsJourney()'),end=source.indexOf('  function formationMove(',start);
 let entity=null;const moves=[];
 const c=vm.createContext({Date,character:{name:'M',ctype:'mage',x:0,y:0,real_x:0,real_y:0,range:200,map:'uhills',in:'uhills',rip:false,base:{h:8,v:7,vn:2}},navigationIntent:{cancelled:false,revision:1},coordinatorClockOffset:0,
  groupedCombat:{independentApproach:true,key:'runtime',selection:'s1',committed:false,target:{id:'boss',x:400,y:0,map:'uhills',in:'uhills',server:'USII',state:'planned'}},partyConvoyActive:false,convoyTraveling:null,eventTraveling:false,joinedEvent:null,
  groupedFarming:()=>true,groupedFresh:()=>true,dungeonOwned:()=>false,runtimeCurrent:()=>true,consoleMovementPaused:()=>false,reunionRealm:()=> 'USII',isAttackingPartyMember:()=>false,
  parent:{socket:{connected:true},entities:{}},get_entity:()=>entity,is_in_range:e=>Math.hypot(e.x-c.character.real_x,e.y-c.character.real_y)<=c.character.range,can_move_to:()=>true,can_move:()=>true,
  combatApproachPoint:(e,r)=>({x:e.x-r,y:e.y}),cancelGroupRoute:()=>{},cancelFightRoute:()=>{},cancelFarmApproach:()=>{},resetCombatMovement:()=>{},movement:{report:()=>null,tick:()=>{},move:(goal,callback,options)=>{moves.push({goal,options});return Promise.resolve();}},
  root:{sharedRoutine:{isOccupied:()=>false},partyRoleRunner:{isKnownDead:()=>false}}});
 vm.runInContext(source.slice(start,end),c);return {c,moves,ports:c.independentApproachPorts(),set entity(v){entity=v;}};
}
test('fresh owned invisible target snapshot routes natively but cannot advertise readiness',async()=>{const f=snapshotPorts(),ctx=f.ports.context();assert.equal(ctx.allowed,true);assert.equal(f.ports.ready(),false);const goal=f.ports.goal(ctx.point,ctx.radius);await f.ports.start(goal,'combat-approach:snapshot');assert.equal(f.moves.length,1);assert.equal(f.moves[0].options.native,undefined);assert.equal(f.moves[0].options.rejectUnreachableGoal,true);assert.equal(f.moves[0].goal.map,'uhills');assert.equal(f.moves[0].goal.in,'uhills');assert.equal(f.ports.ready(),false);f.entity={id:'boss',x:400,y:0,visible:true,dead:false,hp:100};f.c.character.real_x=203;assert.equal(f.ports.ready(),true);});
test('snapshot routing preserves stale realm instance death and manual fences',()=>{for(const change of [f=>f.c.groupedFresh=()=>false,f=>f.c.groupedCombat.target.server='EU',f=>f.c.groupedCombat.target.in='other',f=>f.c.root.partyRoleRunner.isKnownDead=()=>true,f=>f.c.navigationIntent.cancelled=true]){const f=snapshotPorts();change(f);assert.ok(!f.ports.context()?.allowed);assert.equal(f.ports.ready(),false);}});

test('direct connector is attempted first, blocked connector uses owned smart route',()=>{for(const clear of [true,false]){const f=fixture();f.clear=clear;f.client.tick();assert.equal(f.routes[0].direct,clear);}});
test('mid-route actual range holds owned movement and echoes only current ready confirmation',()=>{const f=fixture();f.client.tick();f.ready=true;f.ctx.confirmation='r2';f.client.tick();assert.equal(f.owner,null);assert.equal(f.client.report().phase,'ready');assert.equal(f.client.readiness().confirmation,'r2');f.ready=false;assert.equal(f.client.readiness().confirmation,undefined);f.now=10250;f.ctx.point={x:160,y:100};f.client.tick();assert.equal(f.routes.length,2);});
test('moving target preserves reductions and paces replanning',async()=>{const f=fixture();f.client.tick();f.routes[0].resolve();await Promise.resolve();f.now=10250;f.client.tick();assert.equal(f.client.report().radius,100);f.ctx.point={x:140,y:100};f.now=10300;f.client.tick();assert.equal(f.routes.length,2);f.now=10500;f.client.tick();assert.equal(f.routes.length,3);assert.equal(f.client.report().radius,100);assert.equal(f.client.report().level,1);f.clear=false;f.ctx.point={x:180,y:100};f.now=10750;f.client.tick();assert.equal(f.routes.length,4);f.ctx.point={x:220,y:100};f.now=11000;f.client.tick();assert.equal(f.routes.length,4,'Pending native search must retain its progress when the target drifts');const g=fixture();g.throwing=true;g.client.tick();for(let i=1;i<=12;i++){g.now=10000+i*250;g.client.tick();}assert.equal(g.client.report().phase,'unreachable');const radius=g.client.report().radius,level=g.client.report().level;g.throwing=false;g.ctx.point={x:130,y:100};g.now=15000;g.client.tick();assert.equal(g.routes.length,1,'Changed target geometry may reconsider the already reduced radius');assert.equal(g.client.report().radius,radius);assert.equal(g.client.report().level,level);});
test('native ranged readiness accepts blocked movement ray',()=>{const f=snapshotPorts();f.entity={id:'boss',x:180,y:0,visible:true,dead:false,hp:100};f.c.can_move_to=()=>false;assert.equal(f.ports.ready(),true);});
test('direct journey installs through existing collision-validating executor',async()=>{const f=snapshotPorts();const installed=[];f.c.movement.identity={version:17665,fingerprint:'native'};f.c.movement.install=(plot,identity,engine)=>installed.push({plot,identity,engine});await f.ports.start({x:100,y:0},'combat-approach:direct',true);assert.equal(installed.length,1);assert.equal(installed[0].engine,'direct');assert.equal(installed[0].plot[0].x,100);assert.equal(f.moves[0].options.owner.recoveryStage,'combat-approach:direct');let reject,cancelled=false;f.c.movement.move=()=>new Promise((_,r)=>reject=r);f.c.movement.report=()=>({owner:{recoveryStage:'combat-approach:bad'}});f.c.movement.install=()=>{throw Error('connector changed');};f.c.movement.cancel=()=>{cancelled=true;reject(Error('connector changed'));throw Error('native stop unavailable');};const walking=f.ports.start({x:100,y:0},'combat-approach:bad',true);await assert.rejects(walking,/connector changed/);assert.equal(cancelled,true);});

test('first independent pull rejects stale confirmation or changed actual range, preserving engaged combat',()=>{
 const source=fs.readFileSync('characters/shared.js','utf8'),start=source.indexOf('  function independentPullReady('),end=source.indexOf('  function groupedAttackAllowed(',start);let ready=true,flushes=0;
 const c=vm.createContext({Date:{now:()=>10000},coordinatorClockOffset:0,groupedCombat:{independentApproach:true,selection:'s1',target:{state:'planned'},members:['W','P'],independentReadiness:{W:{target:'boss',selection:'s1',confirmation:'c1',ready:true,at:9900},P:{target:'boss',selection:'s1',confirmation:'c1',ready:true,at:9900}},independentConfirmation:{id:'c1',target:'boss',selection:'s1',startedAt:9800,expiresAt:11000}},root:{partyQueueClient:{independent:{readiness:()=>({target:'boss',selection:'s1',confirmation:'c1',ready})},flush:()=>flushes++}}});
 vm.runInContext(source.slice(start,end),c);assert.equal(c.independentPullReady({id:'boss'}),true);c.groupedCombat.independentReadiness.P.at=8999;assert.equal(c.independentPullReady({id:'boss'}),false,'Peer evidence must still be fresh at actual send');assert.equal(flushes,1);assert.equal(c.independentPullReady({id:'boss'}),false);assert.equal(flushes,1,'Unchanged stale challenge refresh must coalesce');c.groupedCombat.independentReadiness.P.at=9900;assert.equal(c.independentPullReady({id:'boss'}),true);ready=false;assert.equal(c.independentPullReady({id:'boss'}),false);assert.equal(flushes,2);ready=true;c.groupedCombat.independentConfirmation.expiresAt=9999;assert.equal(c.independentPullReady({id:'boss'}),false);c.groupedCombat.target.state='engaged';assert.equal(c.independentPullReady({id:'boss'}),true);
});

test('lost native readiness after smart approach resumes at half radius, initial readiness keeps full radius',()=>{
 for(const previous of ['smart','direct','initial']){const f=fixture();f.clear=previous!=='smart';if(previous!=='initial')f.client.tick();f.ready=true;f.client.tick();f.ready=false;f.ctx.point={x:130,y:100};f.now=10250;f.client.tick();assert.equal(f.client.report().radius,previous==='smart'?100:200);assert.equal(f.client.report().level,previous==='smart'?1:0);}
 const f=fixture();f.clear=false;f.throwing=true;f.client.tick();for(let i=1;i<=12;i++){f.now=10000+i*250;f.client.tick();}f.ready=true;f.client.tick();f.ready=false;f.throwing=false;f.ctx.point={x:130,y:100};f.now=15000;f.client.tick();assert.equal(f.client.report().radius,1);assert.ok(f.client.report().level<=8);
});

test('owned native completion immediately rechecks range and advances an unsuccessful approach',async()=>{
 for(const outcome of ['arrived','failed']){const f=fixture();f.clear=false;f.client.tick();f.now=10500;
  if(outcome==='arrived')f.routes[0].resolve();else f.routes[0].reject(Error('no native route'));
  await Promise.resolve();assert.equal(f.routes.length,2);assert.equal(f.client.report().radius,100);
 }
 const ready=fixture();ready.client.tick();ready.now=10500;ready.ready=true;ready.routes[0].resolve();await Promise.resolve();
 assert.equal(ready.client.report().phase,'ready');assert.equal(ready.routes.length,1);
 const paused=fixture();paused.client.tick();paused.ctx.allowed=false;paused.routes[0].reject(Error('hold'));await Promise.resolve();
 assert.equal(paused.client.report(),null);assert.equal(paused.routes.length,1);
});

test('shared approach starts the owned direct or native executor immediately',async()=>{
 for(const direct of [true,false])for(const matching of [true,false]){const f=snapshotPorts();let started=false,ticks=0;
  const id='combat-approach:immediate';f.ports.position(matching?id:'foreign-route','boss',200,{x:100,y:0},'routing');
  f.c.resetCombatMovement=()=>{f.c.root.partyCombatPosition={mode:'idle',target:null,movementOwner:null};};
  const observeNativeEdge=()=>{const position=f.c.root.partyCombatPosition;
   assert.equal(position.mode,matching?'independent-approach':'idle');
   if(matching){assert.equal(position.approachId,id);assert.equal(position.target,'boss');assert.equal(position.movementOwner,'combat-approach');}};
  f.c.movement.move=()=>{observeNativeEdge();started=true;return Promise.resolve();};
  f.c.movement.install=()=>{};f.c.movement.tick=()=>{assert.equal(started,true);observeNativeEdge();ticks++;};
  await f.ports.start({x:100,y:0},id,direct);assert.equal(ticks,1);
 }
});


test('a slightly farther direct-clear native range candidate wins over the nearest blocked ring point',()=>{
 const f=snapshotPorts();f.entity={id:'boss',x:1400,y:280,visible:true,hp:100};
 Object.assign(f.c.character,{real_x:1437.5,real_y:-445.5,x:1437.5,y:-445.5});
 f.c.combatApproachPoint=(e,r)=>{const a=Math.atan2(f.c.character.real_y-e.y,f.c.character.real_x-e.x);return {x:e.x+Math.cos(a)*r,y:e.y+Math.sin(a)*r};};
 f.c.can_move=p=>p.x===p.going_x&&p.y===p.going_y || p.going_x>1480&&p.going_x<1510;
 const goal=f.ports.goal({x:1400,y:280},207);
 assert.ok(goal.x>1480&&goal.x<1510,'Choose native direct-clear right-hand ring instead of nearest blocked point');
 assert.ok(Math.abs(Math.hypot(goal.x-1400,goal.y-280)-207)<0.001);
 f.c.can_move=p=>p.x===p.going_x&&p.y===p.going_y;
 const blocked=f.ports.goal({x:1400,y:280},207);assert.ok(blocked.x<1420,'All-blocked keeps nearest walkable goal for maintained smart planner');
 f.c.can_move=()=>false;assert.equal(f.ports.goal({x:1400,y:280},207),null);
});


test('own committed arrival retires pull approach until a genuinely new context or explicit stop',()=>{
 const f=fixture();f.ctx.committed=true;f.ctx.planned=false;f.client.tick();assert.equal(f.routes.length,1,'Peer engagement alone must not stop own arrival');
 f.ready=true;assert.equal(f.client.tick(),false);assert.equal(f.owner,null);
 f.ready=false;for(let i=0;i<4;i++){f.now=11000+i*250;assert.equal(f.client.tick(),false,'Normal engaged combat owns subsequent range recovery');}
 assert.equal(f.routes.length,1);
 f.ctx.allowed=false;assert.equal(f.client.tick(),false);f.ctx.allowed=true;assert.equal(f.client.tick(),false);assert.equal(f.routes.length,1,'Same-target defense must retain completed approach');
 f.ctx.key='new-selection';assert.equal(f.client.tick(),true);assert.equal(f.routes.length,2);
 f.ready=true;f.client.tick();f.ready=false;f.client.stop();assert.equal(f.client.tick(),true);assert.equal(f.routes.length,3,'Explicit stop retires completion history');
});
test('shared approach intentional cancellation preserves exact owner and cancellation provenance',()=>{
 const f=snapshotPorts();let owner='combat-approach:owned',cancelled;
 f.c.movement.report=()=>({owner:{recoveryStage:owner}});
 f.c.movement.cancel=(reason,cause)=>{cancelled={reason,cause};};
 f.ports.cancel('foreign');assert.equal(cancelled,undefined);
 f.ports.cancel(owner);assert.match(cancelled.reason,/cancelled/i);assert.equal(cancelled.cause.code,'combat-approach-cancelled');
});


test('projected target center actually drives the native-clear independent goal ring',()=>{
 const f=snapshotPorts(),point={x:400,y:100};f.entity={id:'boss',x:400,y:0,visible:true,hp:100};
 const goal=f.ports.goal(point,197);assert.ok(Math.abs(Math.hypot(goal.x-point.x,goal.y-point.y)-197)<1e-7);
});
test('ordinary combat chase leads only while actual native range is missing',()=>{
 const source=fs.readFileSync('characters/shared.js','utf8'),start=source.indexOf('  function combatApproachPoint('),end=source.indexOf('  function resetCombatMovement(',start);
 const c=vm.createContext({character:{x:0,y:0,real_x:0,real_y:0},desiredCombatRange:()=>20,combatDistance:()=>100,
  combatInterceptCenter:()=>({x:120,y:0}),is_in_range:()=>false});vm.runInContext(source.slice(start,end),c);
 assert.equal(c.combatApproachPoint({x:100,y:0}).x,100,'Aim at projected center minus actual attack reach');
 c.is_in_range=()=>true;assert.equal(c.combatApproachPoint({x:100,y:0}).x,80,'Do not lead a currently ready target');
 assert.equal(c.combatApproachPoint({x:100,y:0},20,{x:110,y:0}).x,90,'Explicit center is not projected twice');
});


test('approach report retains the actually issued center without exposing mutable controller state',()=>{
 const f=fixture();f.client.tick();const report=f.client.report();assert.deepEqual(report.point,{x:100,y:100});
 report.point.x=999;f.ctx.point={x:110,y:100};assert.deepEqual(f.client.report().point,{x:100,y:100});
});


test('issued interception inputs remain immutable when current native direction changes',()=>{
 const f=fixture();f.ctx.prediction={at:10000,target:{x:100,y:100},destination:{x:200,y:200},targetSpeed:30,own:{x:0,y:0},ownSpeed:60,reach:20,horizon:1};
 f.client.tick();const report=f.client.report();assert.equal(report.issuedAt,10000);assert.equal(report.prediction.destination.x,200);
 report.prediction.destination.x=999;f.ctx.prediction.target.x=500;f.ctx.prediction.destination.x=400;
 assert.equal(f.client.report().prediction.destination.x,200);assert.equal(f.client.report().prediction.target.x,100);
});


test('interception radius and goal sampling use the same actual centers despite renderer interpolation',()=>{
 const f=snapshotPorts();Object.assign(f.c.character,{x:0,y:0,real_x:100,real_y:0});
 f.entity={id:'boss',x:1000,y:0,real_x:200,real_y:0,visible:true,hp:100};
 f.c.combatDistance=()=>70;f.c.desiredCombatRange=()=>20;
 const source=fs.readFileSync('characters/shared.js','utf8'),start=source.indexOf('  function combatApproachPoint('),end=source.indexOf('  function resetCombatMovement(',start);
 vm.runInContext(source.slice(start,end),f.c);
 const actual=f.c.combatApproachPoint(f.c.get_entity('boss'),20,{x:200,y:0});assert.equal(actual.x,150,'Reach20 plus current native bodygap30');
 const center={x:300,y:100},goal=f.ports.goal(center,20);
 assert.ok(Math.abs(Math.hypot(goal.x-center.x,goal.y-center.y)-50)<1e-7,'The goal ring must subtract the same actual target center');
});


test('new approaches aim ten units inside range without changing native readiness',()=>{
 const f=snapshotPorts();for(const [range,radius] of [[200,190],[36,26],[8,1]]){f.c.character.range=range;assert.equal(f.ports.context().radius,radius);}
 f.c.character.range=200;f.entity={id:'boss',x:195,y:0,visible:true,hp:100};assert.equal(f.ports.ready(),true,'Native ready does not wait for the ten-unit aim');
});
test('a pending precommit route builds range buffer while confirming actual readiness immediately',()=>{
 const f=fixture();f.clear=false;f.client.tick();f.ready=true;f.buffered=false;
 assert.equal(f.client.tick(),true);assert.equal(f.owner,f.routes[0].id);assert.equal(f.client.readiness().ready,true);assert.equal(f.client.report().pending,true);
 f.ready=false;f.now=10300;f.ctx.point={x:130,y:100};f.client.tick();assert.equal(f.routes.length,1,'Useful pending smart route survives range loss');
 f.ready=true;f.ctx.committed=true;assert.equal(f.client.tick(),false);assert.equal(f.owner,null,'Commit hands off immediately without waiting for buffer');
 const inner=fixture();inner.client.tick();inner.ready=true;inner.buffered=true;inner.client.tick();assert.equal(inner.owner,null);
 const initial=fixture();initial.ready=true;initial.buffered=false;initial.client.tick();assert.equal(initial.routes.length,0);
});
test('ordinary out-of-range interception uses ten-unit buffer and preserves ready melee spacing',()=>{
 const source=fs.readFileSync('characters/shared.js','utf8'),start=source.indexOf('  function combatApproachPoint('),end=source.indexOf('  function resetCombatMovement(',start);
 const c=vm.createContext({character:{x:0,y:0,range:36},desiredCombatRange:()=>34,combatDistance:()=>100,is_in_range:()=>false});vm.runInContext(source.slice(start,end),c);
 assert.equal(c.combatApproachPoint({x:100,y:0}).x,74);c.is_in_range=()=>true;assert.equal(c.combatApproachPoint({x:100,y:0}).x,66);
 const a=source.indexOf('  function formationDesiredRange('),b=source.indexOf('  function formationStepSafe(',a);vm.runInContext(source.slice(a,b),c);
 c.is_in_range=()=>false;assert.equal(c.formationDesiredRange({},null,false,[],10),26);c.is_in_range=()=>true;assert.equal(c.formationDesiredRange({},null,false,[],10),34);
});
