const test=require('node:test'),assert=require('node:assert/strict');
const {predictCombatIntercept}=require('../../runtime/combat/interception.ts');
const origin={x:0,y:0},target={x:100,y:0};
test('interception includes attack reach and actual relative velocity',()=>{
 for(const [vx,vy] of [[10,0],[-10,0],[0,20]]){
  const p=predictCombatIntercept(origin,100,target,20,{vx,vy,duration:20});
  const time=vx?(p.x-100)/vx:p.y/vy;
  assert.ok(time>0&&time<2);assert.ok(Math.abs(Math.hypot(p.x,p.y)-(100*time+20))<1e-7);
 }
});
test('unreachable moving target uses bounded lead and stops at actual native leg endpoint',()=>{
 assert.deepEqual(predictCombatIntercept(origin,20,target,10,{vx:40,vy:0,duration:20}),{x:180,y:0});
 assert.deepEqual(predictCombatIntercept(origin,20,target,10,{vx:40,vy:0,duration:0.25}),{x:110,y:0});
});
test('stationary invalid or missing native motion never fabricates velocity',()=>{
 for(const motion of [undefined,{vx:0,vy:0,duration:10},{vx:NaN,vy:1,duration:10},{vx:1,vy:0,duration:0}])assert.deepEqual(predictCombatIntercept(origin,100,target,20,motion),target);
 for(const speed of [0,-1,NaN,Infinity])assert.deepEqual(predictCombatIntercept(origin,speed,target,20,{vx:10,vy:0,duration:10}),target);
 assert.deepEqual(predictCombatIntercept(origin,100,{x:10,y:0},20,{vx:10,vy:0,duration:10}),{x:10,y:0});
});
