const test=require('node:test'),assert=require('node:assert/strict');
const {createKillLuckSwap}=require('../../runtime/characters/roles/kill-luck-swap.ts');
// Retained isolated test (failure inventory: e2e/gear-sets-failures.md). The kill-time swap needs a
// predicted death and the tank's aggro at the same moment, which the native harness cannot stage
// reliably; these cases drive the real module against an in-memory bag and equipment.
function item(name,level=0,extra={}){return {name,level,...extra};}
function fixture({equipped={},carried=[],luck=null,tank=null,isTank=true}={}){
 const slots={...equipped},bag=[...carried],calls=[];
 const ports={
  now:()=>1000,
  isTank:()=>isTank,
  equipped:slot=>slots[slot]||null,
  items:()=>bag,
  gearSet:name=>name==='luck'?luck:name==='tank'?tank:null,
  fingerprint:i=>i?{...i}:null,
  same:(a,b)=>JSON.stringify(a)===JSON.stringify(b),
  // Native equip swaps the bag item into the slot and the worn one back into the bag.
  equip:(index,slot)=>{const worn=slots[slot]||null;calls.push({slot,item:bag[index]});slots[slot]=bag[index];bag[index]=worn;return Promise.resolve();},
  unequip:slot=>{const free=bag.indexOf(null);bag[free<0?bag.length:free]=slots[slot];slots[slot]=null;calls.push({slot,item:null});return Promise.resolve();},
  lethalBasicAttack:()=>true,
  holdsAggro:()=>true,
  endangered:()=>false,
  otherSwapBusy:()=>false,
  report:()=>{},
 };
 return {ports,slots,bag,calls,swap:createKillLuckSwap(ports,{})};
}
async function settle(swap,target){ swap.tick(target); while(swap.busy()) await new Promise(r=>setTimeout(r,0)); }

test('every carried luck-set member is worn, including both rings from identical copies',async()=>{
 const luck={ring1:item('ringsj',2),ring2:item('ringsj',2),earring1:item('lostearring',1),earring2:item('lostearring',1),amulet:item('lucky',3),cape:item('ecape',4)};
 const equipped={ring1:item('strring',5),ring2:item('strring',5),earring1:item('strearring',4),earring2:item('strearring',4),amulet:item('stramulet',3),cape:item('angelwings',7)};
 const f=fixture({equipped,luck,carried:[item('ringsj',2),item('ringsj',2),item('lostearring',1),item('lostearring',1),item('lucky',3),item('ecape',4)]});
 await settle(f.swap,{id:'boss',hp:1});
 for(const [slot,wanted] of Object.entries(luck)) assert.deepEqual(f.slots[slot],wanted,slot);
 assert.equal(f.calls.length,6);
});

test('a member is matched by level: a lower copy is never worn in its place, and an uncarried member is skipped',async()=>{
 const luck={ring1:item('ringsj',3),amulet:item('lucky',2)};
 const f=fixture({equipped:{ring1:item('strring',5),amulet:item('stramulet',3)},luck,carried:[item('ringsj',1),item('lucky',2)]});
 await settle(f.swap,{id:'boss',hp:1});
 assert.equal(f.slots.ring1.name,'strring');assert.deepEqual(f.slots.amulet,item('lucky',2));
});

test('without a saved luck set nothing is swapped',async()=>{
 const f=fixture({equipped:{ring1:item('strring',5)},carried:[item('ringsj',9)]});
 await settle(f.swap,{id:'boss',hp:1});
 assert.equal(f.calls.length,0);
});

test('after the kill the tank set is restored; a tank piece not carried falls back to the gear worn before the swap',async()=>{
 const luck={ring1:item('ringsj',2),amulet:item('lucky',3)};
 const tank={ring1:item('strring',6),amulet:item('stramulet',4)};
 const f=fixture({equipped:{ring1:item('strring',5),amulet:item('stramulet',3)},luck,tank,carried:[item('ringsj',2),item('lucky',3),item('strring',6)]});
 await settle(f.swap,{id:'boss',hp:1});
 assert.deepEqual(f.slots.ring1,luck.ring1);
 await settle(f.swap,{id:'boss',hp:0,dead:true});
 assert.deepEqual(f.slots.ring1,item('strring',6),'the tank set ring, not the original +5');
 assert.deepEqual(f.slots.amulet,item('stramulet',3),'the tank +4 amulet is not carried, so the pre-swap amulet comes back');
});

test('reserved slots cover set members and swapped-out gear, but not spare copies',async()=>{
 const luck={ring1:item('ringsj',2)};
 const f=fixture({equipped:{ring1:item('strring',5)},luck,tank:{ring1:item('strring',5)},carried:[item('ringsj',2),item('ringsj',2),item('ringsj',1)]});
 assert.deepEqual(f.swap.reservedSlots(),[0],'one copy of the luck ring is held; the spare and the +1 are compound stock');
 await settle(f.swap,{id:'boss',hp:1});
 const bagIndex=f.bag.findIndex(entry=>entry&&entry.name==='strring');
 assert.deepEqual(f.swap.reservedSlots(),[bagIndex],'the swapped-out combat ring is held while the luck ring is worn');
});

test('a character that is not the tank never swaps, but its set members stay held',async()=>{
 const f=fixture({isTank:false,equipped:{ring1:item('strring',5)},luck:{ring1:item('ringsj',2)},carried:[item('ringsj',2)]});
 await settle(f.swap,{id:'boss',hp:1});
 assert.equal(f.calls.length,0);assert.deepEqual(f.swap.reservedSlots(),[0]);
});

test('a luck piece worn where the slot was empty before the swap is taken off again',async()=>{
 const f=fixture({equipped:{ring1:item('strring',5)},luck:{ring1:item('ringsj',2),orb:item('rabbitsfoot',0)},carried:[item('ringsj',2),item('rabbitsfoot',0),null]});
 await settle(f.swap,{id:'boss',hp:1});
 assert.deepEqual(f.slots.orb,item('rabbitsfoot',0));
 await settle(f.swap,{id:'boss',hp:0,dead:true});
 assert.equal(f.slots.orb,null);assert.deepEqual(f.slots.ring1,item('strring',5));
});
