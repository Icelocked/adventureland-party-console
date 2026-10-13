const test=require('node:test'),assert=require('node:assert/strict');
const {createAttackController}=require('../../runtime/characters/roles/attack-controller.ts');
const {createSkillEngine}=require('../../runtime/characters/skills/engine.ts');
const {fixture}=require('./helpers/skill-world.cjs');
test('independent initial attack emits before pending publication can age the final proof',async()=>{
 const keys=['parent','character','sharedRoutine','attack','can_attack','is_in_range','is_on_cooldown','setTimeout','clearTimeout'];
 const saved=Object.fromEntries(keys.map(k=>[k,global[k]]));let controller,allowed=true,nativeAuthorized=false;const calls=[],target={id:'boss',type:'monster',mtype:'snowman',hp:100},state={};
 try{Object.assign(global,{parent:{},character:{ctype:'merchant',damage_type:'physical',slots:{mainhand:{name:'gun'}}},sharedRoutine:{allowsTarget:()=>true,allowsPassingTarget:()=>true,independentPullActive:()=>true,groupedAttackAllowed:()=>allowed,basicAttackReserved:()=>false,noteAttack:()=>{},queueEvidence:(_,s)=>{calls.push(s);if(s==='pending')allowed=false;return 'a';}},can_attack:()=>true,is_in_range:()=>true,is_on_cooldown:()=>false,setTimeout:()=>0,clearTimeout:()=>{},attack:()=>{nativeAuthorized=allowed;calls.push('native');return Promise.resolve();}});
 controller=createAttackController({target:()=>target,selected:()=>target.id,epoch:()=>1,active:()=>true,allowed:()=>true,state:()=>state,report:()=>{}});controller.tick();for(let i=0;i<12;i++)await Promise.resolve();assert.equal(nativeAuthorized,true,'pending publication must not invalidate readiness before the native emission');assert.ok(calls.includes('pending'));
 }finally{controller?.stop();for(const k of keys)if(saved[k]===undefined)delete global[k];else global[k]=saved[k];}
});
test('independent hostile skill emits before pending publication while legacy reservations remain first',async()=>{
 for(const defer of [true,false]){const r=fixture(),t=r.add('a'),calls=[];let proofFresh=true,nativeFresh=null;const engine=createSkillEngine({world:()=>r.w,publishAfterCast:()=>defer,cast:()=>{nativeFresh=proofFresh;calls.push('native');return Promise.resolve();},evidence:(_,s)=>{calls.push(s);if(s==='pending')proofFresh=false;return'a';},diagnostic:()=>{}});assert.equal(await engine.cast({skill:'supershot',targets:[t],category:'damage',reason:'test'}),true);assert.equal(nativeFresh,defer,'only initial independent pulls preserve actual readiness through native emission');assert.ok(calls.includes('engaged'));engine.stop();}
});
const fs=require('node:fs'),vm=require('node:vm');
test('actual shared helper recognizes exact planned independent group target only',()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../../characters/shared.js'),'utf8');const body=source.match(/independentPullActive: function\(target\)\{([^\n]+)\},/)[1];const context=vm.createContext({groupedCombat:{independentApproach:true,target:{id:'boss',state:'planned'}}});const active=vm.runInContext('(function(target){'+body+'})',context);assert.equal(active({id:'boss'}),true);assert.equal(active({id:'other'}),false);context.groupedCombat.target.state='engaged';assert.equal(active({id:'boss'}),false);
});
test('hostile native rejection stays handled when post-send evidence publication throws',async()=>{
 const r=fixture(),t=r.add('a');const engine=createSkillEngine({world:()=>r.w,publishAfterCast:()=>true,cast:()=>Promise.reject(new Error('native rejection')),evidence:()=>{throw Error('publication');},diagnostic:()=>{}});assert.equal(await engine.cast({skill:'supershot',targets:[t],category:'damage',reason:'test'}),false);await new Promise(resolve=>setImmediate(resolve));engine.stop();
});
