const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createIndependentApproachClient}=require('../../runtime/combat/independent-approach-client.ts');
function fixture(){const ctx={allowed:true,planned:true,key:'USII:uhills:target',target:'target',point:{x:100,y:100},radius:200,selection:'s1',committed:false};let owner=null,throwing=false,ready=false;
 const routes=[];const client=createIndependentApproachClient({context:()=>ctx,now:()=>10000,ready:()=>ready,goal:(p,r)=>({x:p.x-r,y:p.y}),
  start:(goal,id)=>{if(throwing)throw Error('native start rejected');owner=id;return new Promise((resolve,reject)=>routes.push({goal,id,resolve,reject}));},
  owned:id=>owner===id,cancel:id=>{if(owner===id)owner=null;},position:()=>{}});
 return {client,routes,ctx,get owner(){return owner;},set throwing(v){throwing=v;},set ready(v){ready=v;}};}
test('late caster begins own route after shared target engagement',()=>{const f=fixture();f.ctx.planned=false;assert.equal(f.client.tick(),true);assert.equal(f.routes.length,1);assert.equal(f.client.report().target,'target');});
test('synchronous native start rejection becomes bounded approach failure',()=>{const f=fixture();f.throwing=true;assert.doesNotThrow(()=>f.client.tick());for(let i=0;i<12;i++)assert.doesNotThrow(()=>f.client.tick());assert.equal(f.client.report().phase,'unreachable');assert.ok(f.client.report().level<=8);});
test('old native completion cannot settle newer owned route',async()=>{const f=fixture();f.client.tick();const first=f.routes[0];f.ctx.point={x:130,y:100};f.client.tick();const second=f.routes[1];first.resolve();await Promise.resolve();assert.equal(f.client.report().pending,true);assert.equal(f.owner,second.id);assert.equal(f.client.report().id,second.id);});
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
  combatApproachPoint:(e,r)=>({x:e.x-r,y:e.y}),cancelGroupRoute:()=>{},cancelFightRoute:()=>{},cancelFarmApproach:()=>{},resetCombatMovement:()=>{},movement:{report:()=>null,move:(goal,callback,options)=>{moves.push({goal,options});return Promise.resolve();}},
  root:{sharedRoutine:{isOccupied:()=>false},partyRoleRunner:{isKnownDead:()=>false}}});
 vm.runInContext(source.slice(start,end),c);return {c,moves,ports:c.independentApproachPorts(),set entity(v){entity=v;}};
}
test('fresh owned invisible target snapshot routes natively but cannot advertise readiness',async()=>{const f=snapshotPorts(),ctx=f.ports.context();assert.equal(ctx.allowed,true);assert.equal(f.ports.ready(),false);const goal=f.ports.goal(ctx.point,ctx.radius);await f.ports.start(goal,'combat-approach:snapshot');assert.equal(f.moves.length,1);assert.equal(f.moves[0].options.native,true);assert.equal(f.moves[0].goal.map,'uhills');assert.equal(f.moves[0].goal.in,'uhills');assert.equal(f.ports.ready(),false);f.entity={id:'boss',x:400,y:0,visible:true,dead:false,hp:100};f.c.character.real_x=203;assert.equal(f.ports.ready(),true);});
test('snapshot routing preserves stale realm instance death and manual fences',()=>{for(const change of [f=>f.c.groupedFresh=()=>false,f=>f.c.groupedCombat.target.server='EU',f=>f.c.groupedCombat.target.in='other',f=>f.c.root.partyRoleRunner.isKnownDead=()=>true,f=>f.c.navigationIntent.cancelled=true]){const f=snapshotPorts();change(f);assert.ok(!f.ports.context()?.allowed);assert.equal(f.ports.ready(),false);}});
