const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {namedFunction}=require('./helpers/named-function.cjs');
const {capturedCommunicationFailure}=require('../../runtime/coordinator/navigation/communication-failure.ts');
const source=fs.readFileSync('characters/shared.js','utf8');
function fixture(handler){
 let now=0,calls=0;const command={id:3,convoyId:'C',epoch:2,routeVersion:1,routeProtocol:4,continuousReturn:1,phase:'shared-travel'};
 const c={character:{name:'W'},convoyTraveling:{id:'C',commandId:3},convoyRuntimeId:'R',convoySignal:{id:'C',commandId:3,epoch:2,routeVersion:1,runtimeId:'R',validUntil:999999},convoyDiagnosticClock:()=>now,convoySignalExpired:()=>false,departureCombatPending:()=>false,eligibleDepartureChests:()=>[],can_use:()=>true,setTimeout:fn=>{now+=250;fn();},request:async(...args)=>{calls++;now+=2000;return handler(calls,c,args);}};
 vm.createContext(c);for(const n of ['convoyRetryableRequest','sharedConvoyIdentity','sharedMovementOptions'])vm.runInContext(namedFunction(source,n),c);
 return {c,command,run:done=>c.sharedMovementOptions(command).barrier({map:'main',x:0,y:0,town:true},0,done),calls:()=>calls};
}
const timeout=()=>Object.assign(new Error('timeout'),{partyRequest:{path:'/movement-barrier',kind:'timeout',status:0}});
for(const completed of [false,true])test('lost '+(completed?'arrival':'departure')+' response retries the same barrier identity',async()=>{
 const bodies=[];const f=fixture((count,c,args)=>{bodies.push(args[1].body);if(count===1)throw timeout();return {ready:true};});
 assert.equal(await f.run(completed),true);assert.equal(f.calls(),2);assert.deepEqual(JSON.parse(JSON.stringify(bodies[0])),JSON.parse(JSON.stringify(bodies[1])));
});
test('permanent HTTP rejection does not retry',async()=>{const f=fixture(()=>{throw Object.assign(new Error('invalid'),{partyRequest:{kind:'http',status:409}});});await assert.rejects(f.run(false));assert.equal(f.calls(),1);});

for(const completed of [false,true])test('before-departure waits for a later barrier poll; completed='+completed,async()=>{
 const f=fixture(count=>{if(count===1)throw Object.assign(Error('Stale movement barrier owner'),{partyRequest:{path:'/movement-barrier',kind:'http',status:409,code:'before-departure'}});return {ready:true};});
 assert.equal(await f.run(completed),false);assert.equal(f.calls(),1);
 assert.equal(await f.run(completed),true);assert.equal(f.calls(),2);
});

test('request preserves typed barrier rejection code through the HTTP boundary',async()=>{
 let fail;
 const c=vm.createContext({api:'http://localhost',root:{},Date,Number,String,Error,Promise,
  convoyDiagnosticClock:()=>0,rememberConvoyStatusRequest(){},diagnosticText:String,
  $:{ajax:()=>({done(){return this;},fail(fn){fail=fn;}})}});
 vm.runInContext(namedFunction(source,'request'),c);
 const pending=c.request('/movement-barrier',{method:'POST'});
 const rejected=assert.rejects(pending,e=>e.partyRequest.code==='superseded' && e.partyRequest.status===409 && e.partyRequest.path==='/movement-barrier');
 fail({status:409,responseJSON:{error:'Stale movement barrier owner',code:'superseded'}},'error','Conflict');
 await rejected;
});

for(const change of ['command','epoch','route','missing','expired'])test('barrier admission distinguishes ownership loss from lease loss: '+change,async()=>{
 const f=fixture(()=>assert.fail('must not send a stale barrier'));
 if(change==='command')f.c.convoyTraveling.commandId++;
 if(change==='epoch')f.c.convoySignal.epoch++;
 if(change==='route')f.c.convoySignal.routeVersion++;
 if(change==='missing')f.c.convoySignal=null;
 if(change==='expired')f.c.convoySignalExpired=()=>true;
 await assert.rejects(f.run(false),e=>e.partyRequest.kind===(['missing','expired'].includes(change)?'network':'aborted'));
 assert.equal(f.calls(),0);
});

test('superseded barrier metadata classifies cancellation without hiding other errors',()=>{
 const {movementFailureCause}=require('../../runtime/characters/movement-error.ts');
 for(const [path,status,code,expected] of [
  ['/movement-barrier',409,'superseded','superseded'],
  ['/movement-barrier',409,'invalid-step',undefined],
  ['/movement-plan',409,'superseded',undefined],
  ['/movement-barrier',503,'superseded','convoy-communication-hold'],
 ]) {
  const error=Object.assign(Error('rejected'),{partyRequest:{path,status,code,kind:'http'}});
  assert.equal(movementFailureCause(error).code,expected);
 }
});
test('outage retries are bounded and retain the original timeout metadata',async()=>{const f=fixture(()=>{throw timeout();});await assert.rejects(f.run(false),e=>e.partyRequest.kind==='timeout');assert.ok(f.calls()<=5);});
test('late successful response cannot release a superseded transition',async()=>{const f=fixture((n,c)=>{c.convoyTraveling.commandId=99;return {ready:true};});await assert.rejects(f.run(false),/superseded/);assert.equal(f.calls(),1);});
test('expired signal stops barrier retries immediately',async()=>{const f=fixture((n,c)=>{c.convoySignalExpired=()=>true;throw timeout();});await assert.rejects(f.run(false));assert.equal(f.calls(),1);});
test('legacy migration requires owned capture and communication-only failure history',()=>{
 const c={id:'C',epoch:2,phase:'failed',recoveryAttempts:1,failureDetails:{failureContext:{convoyId:'C',epoch:2}},failure:'Return route held after two planning cycles; first: GermanicHP: Shared route coordinator signal expired; latest: QwenTina: Error: Error: POST /movement-barrier · timeout'};
 assert.equal(capturedCommunicationFailure(c),true);assert.equal(capturedCommunicationFailure({...c,epoch:3}),false);assert.equal(capturedCommunicationFailure({...c,communicationLegacyRecovered:true}),false);
 assert.equal(capturedCommunicationFailure({...c,failure:c.failure.replace('Shared route coordinator signal expired','No path found')}),false);
});
test('restart recovers a captured communication-only shared-walk failure without restoring its spent route budget',()=>{
 const {initialCommandState}=require('../../runtime/coordinator/navigation/initial-commands.ts');
 const saved={id:'C',epoch:2,phase:'failed',purpose:'shared-walk',routeProtocol:4,continuousReturn:1,participants:['W'],expected:{W:{revision:4}},recoveryAttempts:1,retryExhausted:true,
 failureCode:'route-failed',failureDetails:{failureContext:{convoyId:'C',epoch:2}},failure:'Return route held after two planning cycles; first: GermanicHP: Shared route coordinator signal expired; latest: QwenTina: Error: Error: POST /movement-barrier · timeout'};
 const restored=initialCommandState({activeConvoy:saved},()=>1000).activeConvoy;
 assert.equal(restored.phase,'communication-hold');assert.equal(restored.recoveryAttempts,0);assert.equal(restored.communicationLegacyRecovered,true);
});
