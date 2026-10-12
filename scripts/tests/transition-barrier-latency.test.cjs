const test=require('node:test'),assert=require('node:assert/strict');
const {movementBarrier}=require('../../runtime/coordinator/navigation/movement-barrier.ts');
function fixture(){
 const names=['L','F'];
 const state={activeConvoy:{id:'c',epoch:1,routeVersion:1,routeProtocol:4,phase:'travel',participants:names,completed:[],runtimes:{L:'L',F:'F'}},
  commands:Object.fromEntries(names.map(name=>[name,{convoyId:'c',epoch:1,id:1,navigationRevision:0}])),
  statuses:Object.fromEntries(names.map(name=>[name,{seenAt:1000,map:'halloween',in:'halloween',x:1212,y:101,moving:false,transporting:false,rip:false,hp:100,convoyNavigation:{runtimeId:name}}]))};
 const body=name=>({character:name,convoyId:'c',epoch:1,commandId:1,routeVersion:1,navigationRevision:0,runtimeId:name,step:0,destination:{map:'halloween',x:1212,y:101,method:'door',transport:true,s:4},ready:true});
 const fresh=at=>{for(const s of Object.values(state.statuses))s.seenAt=at;};
 return {state,body,fresh};
}
test('fresh stopped owners can rendezvous when acknowledgements arrive 1.25 seconds apart',()=>{
 const {state,body,fresh}=fixture();
 assert.equal(movementBarrier(state,body('L'),1000).ready,false);
 fresh(2250);
 assert.equal(movementBarrier(state,body('F'),2250).ready,true);
});
for(const [name,change] of [
 ['moving',s=>s.statuses.L.moving=true],
 ['transporting',s=>s.statuses.L.transporting=true],
 ['dead',s=>s.statuses.L.rip=true],
 ['stale observation',s=>s.statuses.L.seenAt=-10000],
 ['new command',s=>s.commands.L.id++],
 ['new runtime',s=>s.statuses.L.convoyNavigation.runtimeId='replacement'],
 ['new navigation intent',s=>s.navigationIntents={L:{revision:1,cancelled:true}}],
 ['different map',s=>s.statuses.L.map='main'],
 ['different instance',s=>s.statuses.L.in='replacement'],
 ['displaced stopped position',s=>s.statuses.L.x+=32],
])test('an old ready acknowledgement cannot authorize '+name,()=>{
 const {state,body,fresh}=fixture();movementBarrier(state,body('L'),1000);fresh(2250);change(state);
 assert.equal(movementBarrier(state,body('F'),2250).ready,false);
});
test('ready acknowledgement remains bounded by three seconds even with current status',()=>{
 const {state,body,fresh}=fixture();movementBarrier(state,body('L'),1000);fresh(4001);
 assert.equal(movementBarrier(state,body('F'),4001).ready,false);
});
test('readiness revocation still prevents a delayed transition',()=>{
 const {state,body,fresh}=fixture();movementBarrier(state,body('L'),1000);fresh(1800);
 movementBarrier(state,{...body('L'),ready:false},1800);fresh(2250);
 assert.equal(movementBarrier(state,body('F'),2250).ready,false);
});
