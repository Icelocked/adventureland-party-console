const test=require('node:test'),assert=require('node:assert/strict');
const {recoverHuntRoute,ownsHuntRoute,routeDestinationKey}=require('../../runtime/coordinator/hunt/route-recovery.ts');
const {movementRelocation}=require('../../runtime/characters/movement-relocation.ts');
const copy=x=>JSON.parse(JSON.stringify(x));
const destination={map:'level4',x:-238,y:-274},alternate={map:'arena',x:0,y:-500},exit={map:'main',x:100,y:200};
function fixture(engine='native') {
 const hunt={cycleId:'hunt1',stage:'mission-travel',participants:['L','F'],missions:[{target:'cgoo',owners:['L'],destination}],currentIndex:0,target:'cgoo'};
 const state={leader:'L',monsterHunt:hunt,statuses:{},commands:{},monsterChoices:[{id:'cgoo',locations:[destination,alternate]}]};
 for(const n of hunt.participants) state.statuses[n]={map:'arena',x:0,y:-500,seenAt:1000,hp:100,server:'I',movementGeometry:{version:17175,fingerprint:'G'},monsterHunt:{id:'cgoo',count:9,remainingMs:100000}};
 const started=[];let id=0,persists=0;
 const ports={now:()=>1000,fresh:()=>true,intent:()=>({revision:1}),persist:()=>persists++,cancelConvoy:()=>{state.activeConvoy=null;state.commands={};},
 start(h,d,label,stage){if(state.activeConvoy)return false;const c=state.activeConvoy={id:'retry'+(++id),epoch:1,location:d,purpose:'monster-hunt',phase:'assemble',participants:h.participants};h.convoyId=c.id;h.stage=stage;for(const n of h.participants)state.commands[n]={id,type:'party-monster-travel',purpose:'monster-hunt',convoyId:c.id};started.push(d);return true;}};
 function fail(engine='native',reason='Native planning timed out (30 seconds)') {
  const c=state.activeConvoy ||= {id:'original',epoch:1,location:destination,purpose:'monster-hunt'};
  Object.assign(c,{phase:'failed',failureCode:'route-failed',failure:reason,failureDetails:{movement:{engine,failureContext:{relocation:{method:'door',origin:{map:'arena',x:0,y:-500},destination:exit}}}}});
 }
 fail(engine);
 return {hunt,state,ports,started,fail,step:()=>recoverHuntRoute(hunt,state,ports),entry:()=>hunt.routeRecovery[routeDestinationKey(destination)],get persists(){return persists;}};
}

test('native exhaustion selects another monster spawn and never dispatches the suggested door',()=>{
 const r=fixture();r.step();assert.equal(r.entry().phase,'excluded');assert.deepEqual(r.started,[r.hunt.missions[0].destination]);assert.equal(r.started[0].map,'arena');assert.equal(r.entry().relocation,undefined);
});
test('ALClient execution failure gets one native attempt, then another spawn',()=>{
 const r=fixture('alclient');r.step();assert.equal(r.entry().phase,'native');assert.equal(r.state.activeConvoy.nativeFallback,true);
 r.fail();r.step();assert.equal(r.entry().phase,'excluded');assert.equal(r.started.length,2);assert.equal(r.started[1].map,'arena');
});
test('no alternative spawn reports exhaustion without inventing travel',()=>{
 const r=fixture();r.state.monsterChoices[0].locations=[destination];r.step();assert.equal(r.started.length,0);assert.match(r.hunt.message,/No reachable cgoo spawn/);
 for(let i=0;i<3;i++)r.step();assert.equal(r.entry().attempts.length,1);assert.equal(r.started.length,0);
});
for(const phase of ['relocation','post-relocation','held'])test('saved '+phase+' door recovery is retired',()=>{
 const r=fixture();const key=routeDestinationKey(destination);r.hunt.routeRecovery={[key]:{destination,geometry:'17175:G',phase,relocation:{method:'door',origin:{map:'main',x:0,y:0},destination:{map:'bank',x:0,y:-37}},attempts:[],firstFailure:'old',message:'old'}};
 Object.assign(r.state.activeConvoy,{phase:'travel',location:{map:'bank',x:0,y:-37},routeRecovery:{key,stage:'relocation'}});
 r.step();assert.equal(r.entry().phase,'excluded');assert.equal(r.entry().relocation,undefined);assert.equal(r.started[0].map,'arena');
});
for(const kind of ['event','merchant','revision','cancelled','dead','turn-in'])test('recovery preserves '+kind+' ownership',()=>{
 const r=fixture();if(kind==='event')r.state.statuses.L.activeEvent='anniversary';if(kind==='merchant')r.state.commands.L={type:'equip-deliveries',id:9};
 if(kind==='revision')r.state.activeConvoy.expected={L:{revision:0}};if(kind==='cancelled')r.ports.intent=()=>({revision:1,cancelled:true});if(kind==='dead')r.ports.fresh=()=>false;if(kind==='turn-in')r.state.statuses.L.monsterHunt.count=0;
 assert.equal(r.step(),false);assert.equal(r.hunt.routeRecovery,undefined);assert.equal(r.started.length,0);
});
test('geometry changes retire the old budget',()=>{
 const r=fixture();r.state.monsterChoices[0].locations=[destination];r.step();r.state.statuses.L.movementGeometry.fingerprint='new';assert.equal(r.step(),false);assert.equal(r.hunt.routeRecovery[routeDestinationKey(destination)],undefined);
});
