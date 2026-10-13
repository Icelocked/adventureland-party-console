const test=require('node:test'),assert=require('node:assert/strict');
const {evaluateGroup}=require('../../runtime/combat/grouped.ts');
const target={id:'A',mtype:'sparkbot',map:'main',in:'main',server:'USI',x:400,y:0};
function fixture(){
 let now=1000,g=null;const members=['W','P','M'].map((name,i)=>({name,ctype:['warrior','priest','mage'][i],revision:1,status:{seenAt:now,hp:100,map:'main',in:'main',server:'USI',x:i*400,y:0,range:200,
 combatSelection:{runtimeId:name},groupedCombat:{protocol:4,independentApproach:true,anchorVisible:false,candidates:i===0?[target]:[],evidence:[],currentAttackers:[],currentAttackersAt:now}}}));
 return {members,get g(){return g;},get now(){return now;},tick(){members.forEach(m=>{m.status.seenAt=now;m.status.groupedCombat.currentAttackersAt=now;});g=evaluateGroup(g,members,'W',now);now+=100;return g;},ready(nativeReady=true){for(let i=0;i<8;i++){this.tick();for(const m of members){m.status.groupedCombat.ack=g.selection;m.status.groupedCombat.queueAck=g.queueRevision;m.status.groupedCombat.independentReady={selection:g.selection,target:g.target?.id,at:now,ready:nativeReady};}}return this.tick();}};
}
test('capable separated actors acknowledge one shared planned target without healer regroup',()=>{
 const f=fixture(),g=f.ready();assert.equal(g.independentApproach,true);assert.equal(g.target.id,'A');assert.equal(g.committed,true);assert.deepEqual(g.recovering,[]);assert.deepEqual(g.participating,['W','P','M']);
});
test('a first actor hit preserves the shared target and independent mode for peers still approaching',()=>{
 const f=fixture();f.ready();f.members[0].status.groupedCombat.evidence=[{...target,at:f.now,startedAt:f.now,action:'W-hit',state:'engaged'}];
 const g=f.tick();assert.equal(g.independentApproach,true);assert.equal(g.target.id,'A');assert.equal(g.target.state,'engaged');assert.equal(g.committed,true);assert.deepEqual(g.recovering,[]);
});
test('capability does not authorize a nomination without all current target acknowledgements',()=>{
 const f=fixture();for(let i=0;i<9;i++)f.tick();assert.equal(f.g.independentApproach,true);assert.equal(f.g.committed,false);
});
test('mixed clients keep the legacy healer coverage requirement',()=>{
 const f=fixture();delete f.members[2].status.groupedCombat.independentApproach;const g=f.ready();assert.equal(g.independentApproach,false);assert.equal(g.committed,false);assert.ok(g.recovering.includes('W'));
});
for(const [label,mutate] of [
 ['manual navigation',f=>f.members[2].cancelled=true],['death',f=>f.members[2].status.hp=0],
 ['event ownership',f=>f.members[2].status.joinedEvent='mrgreen'],['foreign realm',f=>f.members[2].status.server='USII'],
 ['foreign instance',f=>f.members[2].status.in='elsewhere'],['foreign map',f=>f.members[2].status.map='arena'],
 ['old combat protocol',f=>f.members[2].status.groupedCombat.protocol=3],['loot',f=>f.members[2].status.groupedCombat.lootPending=true],
 ])test('independent approach cannot authorize a new pull through '+label,()=>{const f=fixture();mutate(f);assert.equal(f.ready().committed,false);});
test('stale capability reports cannot authorize independent approach',()=>{
 const f=fixture();f.ready();f.members[2].status.seenAt=0;const g=evaluateGroup(f.g,f.members,'W',10000);assert.equal(g.independentApproach,false);assert.equal(g.committed,false);
});
test('pending attack remains owned despite a closer independent nomination',()=>{
 const f=fixture();f.ready();f.members[0].status.groupedCombat.evidence=[{...target,at:f.now,startedAt:f.now,action:'W-pending',state:'pending'}];
 f.members[0].status.groupedCombat.candidates.push({...target,id:'B',x:20});const g=f.tick();assert.equal(g.target.id,'A');assert.equal(g.target.state,'pending');assert.equal(g.independentApproach,true);
});

test('target acknowledgements and queue preack cannot let early arrivals attack before all peers are native ready',()=>{
 const f=fixture(),g=f.ready(false);assert.equal(g.committed,false);
 f.members[0].status.groupedCombat.independentReady.ready=true;assert.equal(f.tick().committed,false);
 f.members[1].status.groupedCombat.independentReady.ready=true;assert.equal(f.tick().committed,false);
 f.members[2].status.groupedCombat.independentReady.ready=true;assert.equal(f.tick().committed,true);
});
test('missing stale future or foreign independent readiness never authorizes a planned pull',()=>{
 for(const mutate of [
  f=>delete f.members[2].status.groupedCombat.independentReady,
  f=>f.members[2].status.groupedCombat.independentReady.at=f.now-4000,
  f=>f.members[2].status.groupedCombat.independentReady.at=f.now+10000,
  f=>f.members[2].status.groupedCombat.independentReady.target='B',
  f=>f.members[2].status.groupedCombat.independentReady.selection='retired-selection',
 ]){const f=fixture();f.ready();mutate(f);assert.equal(f.tick().committed,false);}
});
test('a native attacker and engaged fight stay owned when independent peer readiness is absent',()=>{
 const f=fixture();f.ready();delete f.members[2].status.groupedCombat.independentReady;
 f.members[0].status.groupedCombat.evidence=[{...target,at:f.now,startedAt:f.now,action:'native-defense-hit',state:'engaged'}];
 const g=f.tick();assert.equal(g.target.id,'A');assert.equal(g.target.state,'engaged');assert.equal(g.committed,true);
});
