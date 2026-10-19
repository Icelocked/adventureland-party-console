const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/skill-world.cjs');
const {fanStand,attackChoices}=require('../../runtime/characters/skills/offense.ts');
// Retained isolated test (failure inventories: e2e/rogue-fan-scatter-failures.md 10 and
// e2e/rogue-fan-crab-rate-failures.md 1-3). Which spot covers the most one-shot mobs depends on
// exact layouts the native spawns do not reproduce on demand; these cases drive the real stand
// selection on fixed layouts. Reach is Fan of Knives' 160, centre to centre.
const reach=160;
const covered=(stand,monsters)=>monsters.filter(m=>Math.hypot(m.x-stand.x,m.y-stand.y)<=reach).length;
function world(layout,actor={x:0,y:0}){
 const r=fixture('rogue');Object.assign(r.actor,actor,{attack:1000});
 const ms=layout.map(([x,y],i)=>r.add('m'+i,{hp:100,max_hp:100,x,y}));
 return {r,ms};
}

test('10: the stand covers the most one-shot mobs, not the middle of everything nearby',()=>{
 // The target at the origin, three mobs 260 east and three 260 west: the middle reaches only the target.
 const {r,ms}=world([[0,0],[260,0],[265,10],[262,-12],[-260,0],[-265,10],[-262,-12]]);
 const stand=fanStand(r.w,ms[0]);
 assert.equal(covered(stand,ms),4,'the target and one whole group');
});

test('10: five mobs in reach is enough; a fifth nearby beats a farther larger group',()=>{
 const {r,ms}=world([[0,0],[60,0],[0,60],[60,60],[30,30],[-250,0],[-255,8],[-258,-8],[-262,4],[-266,-4],[-270,0]]);
 const stand=fanStand(r.w,ms[0]);
 assert.ok(covered(stand,ms.slice(0,5))===5,'the five beside the target');
});

test('10: a rogue whose spot already reaches as many holds still',()=>{
 const {r,ms}=world([[0,0],[40,0],[0,40]],{x:20,y:20});
 assert.deepEqual(fanStand(r.w,ms[0]),{x:20,y:20});
});

test('crab rate 2: a lone primary does not hold the rogue away from a full group',()=>{
 // The scatter primary alone at the origin; five one-shot mobs together 400 east.
 const {r,ms}=world([[0,0],[400,0],[410,20],[395,-15],[420,-5],[405,10]]);
 const stand=fanStand(r.w,ms[0]);
 assert.equal(covered(stand,ms.slice(1)),5,'all five of the group');
});

test('crab rate 2: reach is Fan of Knives range, not 20 short of it',()=>{
 // Two mobs 155 either side of the rogue: both in reach where it stands.
 const {r,ms}=world([[155,0],[-155,0]]);
 assert.deepEqual(fanStand(r.w,ms[0]),{x:0,y:0});
});

test('crab rate 1: knives go to the one-shot mobs in range when the primary is out of range',()=>{
 const {r,ms}=world([[400,0],[40,0],[0,40],[-40,0]]);
 r.w.range=(t)=>Math.hypot(t.x-r.actor.x,t.y-r.actor.y)<=160;
 const fan=attackChoices(r.w,ms[0]).find(d=>d.skill==='fanofknives');
 assert.ok(fan,'Fan of Knives is offered');
 assert.deepEqual(fan.targets.map(t=>t.id).sort(),['m1','m2','m3']);
});
