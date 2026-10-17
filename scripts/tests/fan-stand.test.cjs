const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/skill-world.cjs');
const {fanStand}=require('../../runtime/characters/skills/offense.ts');
// Retained isolated test (failure inventory: e2e/rogue-fan-scatter-failures.md 10). Which spot
// covers the most one-shot mobs depends on exact layouts the native spawns do not reproduce on
// demand; these cases drive the real stand selection on fixed layouts.
const reach=140;
const covered=(stand,monsters)=>monsters.filter(m=>Math.hypot(m.x-stand.x,m.y-stand.y)<=reach).length;
function world(layout,actor={x:0,y:0}){
 const r=fixture('rogue');Object.assign(r.actor,actor,{attack:1000});
 const ms=layout.map(([x,y],i)=>r.add('m'+i,{hp:100,max_hp:100,x,y}));
 return {r,ms};
}

test('10: the stand covers the most one-shot mobs with the target, not the middle of everything nearby',()=>{
 // The target at the origin, three mobs 260 east and three 260 west: the middle reaches only the target.
 const {r,ms}=world([[0,0],[260,0],[265,10],[262,-12],[-260,0],[-265,10],[-262,-12]]);
 const stand=fanStand(r.w,ms[0]);
 assert.ok(Math.hypot(stand.x,stand.y)<=reach,'the target stays in reach');
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
