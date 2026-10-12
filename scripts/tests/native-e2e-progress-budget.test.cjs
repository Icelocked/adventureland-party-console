const test=require('node:test'),assert=require('node:assert/strict');
const{createNativeProgressBudget}=require('../../e2e/native-progress-budget.ts');
test('duplicate native progress cannot renew the quiet completion budget',()=>{
 let now=0;const b=createNativeProgressBudget(()=>now,300000,600000);
 b.observe(['room:already-done','choice:already-resolved']);
 now=299999;b.observe(['room:already-done','choice:already-resolved']);b.check();
 now=300000;assert.throws(()=>b.check(),/no new native progress/);
});
test('a distinct native completion permits the observed 303-second finish',()=>{
 let now=0;const b=createNativeProgressBudget(()=>now,300000,600000);
 b.observe(['room:boss']);now=250000;b.observe(['room:boss','room:guards']);
 now=303300;b.observe(['room:boss','room:guards','room:chest']);b.check();
 assert.equal(b.snapshot().lastProgressAt,303300);
 assert.equal(b.snapshot().markers.length,3);
});
test('native progress never bypasses the absolute completion cap',()=>{
 let now=0;const b=createNativeProgressBudget(()=>now,300000,600000);
 b.observe([]);
 for(now=100000;now<600000;now+=100000){b.observe(['choice:'+now]);b.check();}
 assert.throws(()=>{b.observe(['choice:600000']);b.check();},/absolute completion budget/);
});
