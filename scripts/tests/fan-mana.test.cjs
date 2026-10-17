const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/skill-world.cjs');
const {blocked,reserve}=require('../../runtime/characters/skills/eligibility.ts');
const {bestAttack,fanStand}=require('../../runtime/characters/skills/offense.ts');
const {createSkillEngine}=require('../../runtime/characters/skills/engine.ts');
const {decision}=require('../../runtime/characters/skills/types.ts');
// Retained isolated test (failure inventory: e2e/rogue-fan-scatter-failures.md 11-12). A rogue that
// outspends its potions and a server cooldown race are not reproducible on demand natively.
function fanWorld(mp){
 const r=fixture('rogue');Object.assign(r.actor,{attack:1000,max_mp:1000,mp});
 const a=r.add('a',{hp:100,max_hp:100}),b=r.add('b',{hp:100,max_hp:100});
 return {r,a,b};
}

test('11: while fan-farming, Fan of Knives may dip into the survival reserve down to its own cost',()=>{
 const {r,a,b}=fanWorld(250);
 assert.ok(250-180<reserve(r.w),'below the 20% reserve after casting');
 assert.equal(blocked(r.w,decision('fanofknives',[a,b])),null);
 assert.equal(bestAttack(r.w,a,d=>!blocked(r.w,d)).skill,'fanofknives');
 assert.ok(fanStand(r.w,a),'the stand holds while one cast is affordable');
 r.actor.mp=150;
 assert.equal(blocked(r.w,decision('fanofknives',[a,b])),'insufficient MP');
});

test('11: other skills, and Fan of Knives outside fan-farming, keep the reserve',()=>{
 const {r,a}=fanWorld(250);
 assert.equal(blocked(r.w,decision('mentalburst',[a])),'survival MP reserved');
 r.w.context.mode='grouped';
 assert.equal(blocked(r.w,decision('fanofknives',[a])),'survival MP reserved');
});

test('12: a cooldown rejection does not lock Fan of Knives out; another failure still does',async()=>{
 const {r,a}=fanWorld(1000);
 let reply='cooldown';
 const engine=createSkillEngine({...r.ports,cast:async d=>{r.calls.push(d);if(reply)throw Object.assign(new Error(reply),{reason:reply});return {targets:d.targets.map(t=>t.id)};}});
 assert.equal(await engine.attack(a),false);
 reply=null;
 assert.equal(await engine.attack(a),true,'retried on the next attack');
 reply='no_target';
 assert.equal(await engine.attack(a),false);
 assert.equal(engine.attack(a),null,'other failures keep the one-second lockout');
});
