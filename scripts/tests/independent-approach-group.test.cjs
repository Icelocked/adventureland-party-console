const test=require('node:test'),assert=require('node:assert/strict');
const {evaluateGroup}=require('../../runtime/combat/grouped.ts');
const target={id:'A',mtype:'sparkbot',map:'main',in:'main',server:'USI',x:400,y:0};
function fixture(){
 let now=1000,g=null;const members=['W','P','M'].map((name,i)=>({name,ctype:['warrior','priest','mage'][i],revision:1,status:{seenAt:now,hp:100,map:'main',in:'main',server:'USI',x:i*400,y:0,range:200,
 combatSelection:{runtimeId:name},groupedCombat:{protocol:4,independentApproach:true,anchorVisible:false,candidates:i===0?[target]:[],evidence:[],currentAttackers:[],currentAttackersAt:now}}}));
 return {members,get g(){return g;},get now(){return now;},tick(){members.forEach(m=>{m.status.seenAt=now;m.status.groupedCombat.currentAttackersAt=now;});g=evaluateGroup(g,members,'W',now);now+=100;return g;},ready(nativeReady=true){for(let i=0;i<8;i++){this.tick();for(const m of members){m.status.groupedCombat.ack=g.selection;m.status.groupedCombat.queueAck=g.queueRevision;m.status.groupedCombat.independentReady={selection:g.selection,target:g.target?.id,at:now,ready:nativeReady,confirmation:g.independentConfirmation?.id};}}return this.tick();}};
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
 f.members[2].status.groupedCombat.independentReady.ready=true;assert.equal(f.tick().committed,false);
 const round=f.g.independentConfirmation;for(const m of f.members)m.status.groupedCombat.independentReady={selection:f.g.selection,target:'A',at:f.now,ready:true,confirmation:round.id};
 assert.equal(f.tick().committed,true);
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

function firstReadyRound(){const f=fixture();f.ready(false);for(const m of f.members)m.status.groupedCombat.independentReady={selection:f.g.selection,target:'A',at:f.now,ready:true};f.tick();return f;}
function confirmRound(f,round=f.g.independentConfirmation){for(const m of f.members)m.status.groupedCombat.independentReady={selection:f.g.selection,target:'A',at:f.now,ready:true,confirmation:round.id};}
test('first native readiness begins a challenge without permitting any attack',()=>{
 const f=firstReadyRound();assert.equal(f.g.committed,false);assert.ok(f.g.independentConfirmation);
 assert.equal(f.g.independentConfirmation.selection,f.g.selection);assert.equal(f.g.independentConfirmation.target,'A');
 confirmRound(f);assert.equal(f.tick().committed,true);
});
test('cached pre-challenge readiness and partial confirmation cannot complete the second native check',()=>{
 const f=firstReadyRound(),round=f.g.independentConfirmation;assert.ok(round);
 for(const m of f.members){m.status.groupedCombat.independentReady.confirmation=round.id;m.status.groupedCombat.independentReady.at=round.startedAt-1;}
 assert.equal(f.tick().committed,false);
 f.members[0].status.groupedCombat.independentReady.at=f.now;assert.equal(f.tick().committed,false);
 confirmRound(f);assert.equal(f.tick().committed,true);
});
test('false readiness retires the round and its old token cannot authorize a replacement round',()=>{
 const f=firstReadyRound(),old=f.g.independentConfirmation;assert.ok(old);
 f.members[2].status.groupedCombat.independentReady.ready=false;assert.equal(f.tick().independentConfirmation,undefined);
 confirmRound(f,old);f.tick();const next=f.g.independentConfirmation;assert.notEqual(next.id,old.id);assert.equal(f.g.committed,false);
 confirmRound(f);assert.equal(f.tick().committed,true);
});
test('final native confirmation must be fresh within1000ms and issued after the challenge',()=>{
 const f=firstReadyRound(),round=f.g.independentConfirmation;assert.ok(round);confirmRound(f);
 f.members[2].status.groupedCombat.independentReady.at=round.startedAt-1;assert.equal(f.tick().committed,false);
 confirmRound(f);f.members[2].status.groupedCombat.independentReady.at=f.now-1001;assert.equal(f.tick().committed,false);
});
test('expired challenge and foreign confirmation never authorize an independent planned pull',()=>{
 const f=firstReadyRound(),round=f.g.independentConfirmation;assert.ok(round);confirmRound(f);
 f.members[2].status.groupedCombat.independentReady.confirmation='foreign';assert.equal(f.tick().committed,false);
 confirmRound(f);for(const m of f.members){m.status.seenAt=round.expiresAt+1;m.status.groupedCombat.independentReady.at=round.expiresAt+1;}
 const g=evaluateGroup(f.g,f.members,'W',round.expiresAt+1);assert.equal(g.committed,false);assert.notEqual(g.independentConfirmation?.id,round.id);
});

test('a fresh challenge echo in the issue millisecond commits immediately without another tick',()=>{
 const f=firstReadyRound(),round=f.g.independentConfirmation;assert.ok(round);
 for(const m of f.members){m.status.seenAt=round.startedAt;m.status.groupedCombat.independentReady={selection:f.g.selection,target:'A',at:round.startedAt,ready:true,confirmation:round.id};}
 const g=evaluateGroup(f.g,f.members,'W',round.startedAt);assert.equal(g.committed,true);assert.equal(g.independentConfirmation.id,round.id);
});
