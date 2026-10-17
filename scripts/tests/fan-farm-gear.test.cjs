const test=require('node:test'),assert=require('node:assert/strict');
const {createFanFarmGear}=require('../../runtime/characters/roles/fan-farm-gear.ts');
// Retained isolated test (failure inventory: e2e/gear-sets-failures.md 28-31). A set too weak for
// the farmed mob, respawn gaps and slot reservations are hard to stage natively; these cases drive
// the real module against an in-memory bag, equipment and clock. The live journey is
// e2e/live-fan-farm-gear.spec.ts.
function item(name,level=0){return {name,level};}
function fixture({equipped={},carried=[],fan=null,verdict='lethal'}={}){
 const slots={...equipped},bag=[...carried],calls=[],reports=[],clock={now:0},state={verdict};
 const ports={
  now:()=>clock.now,
  equipped:slot=>slots[slot]||null,
  items:()=>bag,
  gearSet:()=>fan,
  fingerprint:i=>i?{...i}:null,
  same:(a,b)=>JSON.stringify(a)===JSON.stringify(b),
  equip:(index,slot)=>{const worn=slots[slot]||null;calls.push({slot,item:bag[index]});slots[slot]=bag[index];bag[index]=worn;return Promise.resolve();},
  unequip:slot=>{const free=bag.indexOf(null);bag[free<0?bag.length:free]=slots[slot];slots[slot]=null;calls.push({slot,item:null});return Promise.resolve();},
  verdict:()=>state.verdict,
  otherSwapBusy:()=>false,
  report:message=>reports.push(message),
 };
 return {ports,slots,bag,calls,reports,clock,state,gear:createFanFarmGear(ports,{})};
}
async function at(f,ms,allowed=true){ f.clock.now=ms; f.gear.tick(allowed); while(f.gear.busy()) await new Promise(r=>setTimeout(r,0)); }
const fan={ring1:item('ringsj',2),ring2:item('ringsj',2),earring1:item('cearring',1)};
const normal={ring1:item('vitring',5),ring2:item('vitring',5)};
const carried=()=>[item('ringsj',2),item('ringsj',2),item('cearring',1)];

test('26: the set goes on once Fan of Knives has one-shot the mobs in view for two seconds',async()=>{
 const f=fixture({equipped:normal,carried:carried(),fan});
 await at(f,0); await at(f,1500);
 assert.equal(f.calls.length,0,'not before two seconds');
 await at(f,2100);
 for(const [slot,wanted] of Object.entries(fan)) assert.deepEqual(f.slots[slot],wanted,slot);
});

test('27: the set never goes on outside scatter fan-farming, or without a saved set',async()=>{
 const off=fixture({equipped:normal,carried:carried(),fan,verdict:'off'});
 for(const ms of [0,3000,6000]) await at(off,ms);
 assert.equal(off.calls.length,0);
 const unsaved=fixture({equipped:normal,carried:carried()});
 for(const ms of [0,3000,6000]) await at(unsaved,ms);
 assert.equal(unsaved.calls.length,0);
 const blocked=fixture({equipped:normal,carried:carried(),fan});
 for(const ms of [0,3000,6000]) await at(blocked,ms,false);
 assert.equal(blocked.calls.length,0,'combat not allowed');
});

test('28: with nothing in view between respawns the set stays on',async()=>{
 const f=fixture({equipped:normal,carried:carried(),fan});
 await at(f,0); await at(f,2100);
 f.state.verdict='unseen';
 for(const ms of [5000,20000,60000]) await at(f,ms);
 assert.deepEqual(f.slots.ring1,fan.ring1);
});

test('27, 30: leaving fan-farming for three seconds restores the previous gear, emptying slots that were empty',async()=>{
 const f=fixture({equipped:normal,carried:carried(),fan});
 await at(f,0); await at(f,2100);
 f.state.verdict='off';
 await at(f,3000); await at(f,5000);
 assert.deepEqual(f.slots.ring1,fan.ring1,'not before three seconds');
 await at(f,6200);
 assert.deepEqual(f.slots.ring1,normal.ring1);assert.deepEqual(f.slots.ring2,normal.ring2);
 assert.equal(f.slots.earring1,null,'the earring slot was empty before');
});

test('29: a set too weak for the farmed mob comes off, says why, and waits ten minutes',async()=>{
 const f=fixture({equipped:normal,carried:carried(),fan});
 await at(f,0); await at(f,2100);
 f.state.verdict='weak';
 await at(f,4000);
 assert.deepEqual(f.slots.ring1,normal.ring1);
 assert.match(f.reports.join('\n'),/does not one-shot/);
 f.state.verdict='lethal';
 for(const ms of [10000,60000,300000]) await at(f,ms);
 assert.deepEqual(f.slots.ring1,normal.ring1,'still waiting');
 await at(f,700000); await at(f,702500);
 assert.deepEqual(f.slots.ring1,fan.ring1,'tries again after ten minutes');
});

test('a convoy departure restores at once, and a manual equip holds the set off for ten minutes',async()=>{
 const f=fixture({equipped:normal,carried:carried(),fan});
 await at(f,0); await at(f,2100);
 f.gear.depart(); while(f.gear.busy()) await new Promise(r=>setTimeout(r,0));
 assert.deepEqual(f.slots.ring1,normal.ring1);
 await f.gear.manual();
 for(const ms of [5000,8000,300000]) await at(f,ms);
 assert.deepEqual(f.slots.ring1,normal.ring1);
 await at(f,700000); await at(f,702500);
 assert.deepEqual(f.slots.ring1,fan.ring1);
});

test('31: carried set pieces and the gear waiting to be restored are reserved from automatic rules',async()=>{
 const f=fixture({equipped:normal,carried:[item('vitring',1),...carried()],fan});
 assert.deepEqual(f.gear.reservedSlots(),[1,2,3],'set pieces in the bag; the spare ring is free');
 await at(f,0); await at(f,2100);
 const held=f.gear.reservedSlots().map(i=>f.bag[i]);
 assert.deepEqual(held.filter(i=>i.name==='vitring'&&i.level===5).length,2,'both restored rings are held');
 assert.ok(!held.some(i=>i.name==='vitring'&&i.level===1),'the spare ring stays eligible');
});

test('26, 28: kills that empty the view between casts do not keep restarting the swap-in',async()=>{
 const f=fixture({equipped:normal,carried:carried(),fan});
 const pattern=['lethal','unseen','lethal','unseen','lethal'];
 for(let i=0;i<pattern.length;i++){ f.state.verdict=pattern[i]; await at(f,i*600, i!==3); }
 assert.deepEqual(f.slots.ring1,fan.ring1,'worn after two seconds of fan-farming with gaps');
});
