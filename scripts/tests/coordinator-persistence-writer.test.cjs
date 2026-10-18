const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorPersistence}=require('../../runtime/coordinator/persistence/writer.ts');
test('settings persist selections before settings and exclude transient state and auth keys',()=>{
 const writes=[],state={monsterFocus:[],merchantCharacter:'M',commands:{secret:'runtime'},aldata:{key:'auth-secret',trades:[1]}};
 const writer=createCoordinatorPersistence(state,{set:(key,value)=>writes.push([key,JSON.parse(JSON.stringify(value))])});writer.settings();
 assert.equal(writes[0][0],'party_dashboard_selections_state_v1');assert.deepEqual(writes[0][1].monsterFocus,[]);assert.equal(writes[1][0],'party_dashboard_settings_state_v1');assert.deepEqual(writes[1][1].aldataTrades,[1]);assert.equal(writes[1][1].commands,undefined);assert.equal(JSON.stringify(writes).includes('auth-secret'),false);
 state.monsterFocus=['bat'];writer.settings();assert.deepEqual(writes[2][1].monsterFocus,['bat']);
});
test('persistence writes separate roster, bank, capped history and authentication documents',()=>{
 const writes=[],state={headlessSlots:['F'],bankbois:{B:{}},merchantActivity:Array.from({length:501},(_,i)=>i),combatLogs:{F:Array.from({length:501},(_,i)=>i)},aldata:{key:'key',auth:'YES',requestTimes:[1]}};
 const writer=createCoordinatorPersistence(state,{set:(key,value)=>writes.push([key,JSON.parse(JSON.stringify(value))])});writer.roster();writer.bank();writer.historyNow();writer.aldata();
 assert.deepEqual(writes.map(x=>x[0]),['party_dashboard_roster_state_v1','party_dashboard_bank_state_v1','party_dashboard_history_state_v1','party_dashboard_aldata_state_v1']);assert.deepEqual(writes[0][1],{headlessSlots:['F']});assert.deepEqual(writes[1][1],{bankbois:{B:{}}});assert.equal(writes[2][1].merchantActivity[0],1);assert.equal(writes[2][1].combatLogs.F.length,500);assert.deepEqual(writes[3][1],{key:'key',auth:'YES'});
});
test('failed first settings write prevents the second write',()=>{
 let calls=0;const writer=createCoordinatorPersistence({aldata:{}},{set(){calls++;throw Error('disk');}});
 assert.throws(()=>writer.settings(),/disk/);assert.equal(calls,1);
});

 test('scheduled saves coalesce and immediate settings cancel the pending save',async()=>{
 const writes=[],state={monsterFocus:[],aldata:{}};
 const writer=createCoordinatorPersistence(state,{set:(key,value)=>writes.push([key,JSON.parse(JSON.stringify(value))])});
 writer.scheduleSettings();state.monsterFocus=['bat'];writer.scheduleSettings();
 assert.equal(writes.length,0);writer.flush();assert.equal(writes.length,2);
 assert.deepEqual(writes[0][1].monsterFocus,['bat']);state.monsterFocus.push('goo');
 assert.deepEqual(writes[0][1].monsterFocus,['bat']);
 writer.scheduleSettings();writer.settings();await new Promise(resolve=>setTimeout(resolve,1100));assert.equal(writes.length,4);
 });

// History saves: docs/efficiency.md (Persistence), failure inventory P2.
const {HISTORY_SAVE_MS}=require('../../runtime/coordinator/persistence/writer.ts');
function historyFixture(t,storage){
 t.mock.timers.enable({apis:['setTimeout']});
 const writes=[],state={aldata:{},merchantActivity:[],combatLogs:{W:[]}};
 const writer=createCoordinatorPersistence(state,storage||{set:(key,value)=>writes.push([key,JSON.parse(JSON.stringify(value))])});
 return {writes,state,writer};
}
test('a burst of history lines saves one ordered document inside the save window',t=>{
 const {writes,state,writer}=historyFixture(t);
 assert.ok(HISTORY_SAVE_MS>0&&HISTORY_SAVE_MS<=5000);
 for(let i=0;i<50;i++){state.combatLogs.W.push({at:i,message:'line '+i});writer.history();}
 assert.equal(writes.length,0,'no document per line');
 t.mock.timers.tick(HISTORY_SAVE_MS-1);assert.equal(writes.length,0);
 state.combatLogs.W.push({at:50,message:'line 50'});writer.history();
 t.mock.timers.tick(1);
 assert.equal(writes.length,1);assert.equal(writes[0][0],'party_dashboard_history_state_v1');
 assert.deepEqual(writes[0][1].combatLogs.W.map(entry=>entry.at),Array.from({length:51},(_,i)=>i),'every line, in order, once');
 t.mock.timers.tick(HISTORY_SAVE_MS*3);assert.equal(writes.length,1,'clean history does not save again');
 state.merchantActivity.push({at:99,message:'merchant'});writer.history();t.mock.timers.tick(HISTORY_SAVE_MS);
 assert.equal(writes.length,2);assert.equal(writes[1][1].merchantActivity.length,1);
});
test('shutdown flush saves pending history once and cancels the timer',t=>{
 const {writes,state,writer}=historyFixture(t);
 state.combatLogs.W.push({at:1,message:'last words'});writer.history();
 writer.flush();assert.equal(writes.length,1);assert.equal(writes[0][1].combatLogs.W[0].message,'last words');
 t.mock.timers.tick(HISTORY_SAVE_MS*2);assert.equal(writes.length,1);
 writer.flush();assert.equal(writes.length,1,'nothing pending after flush');
});
test('historyNow saves at once and replaces a pending save',t=>{
 const {writes,state,writer}=historyFixture(t);
 state.combatLogs.W.push({at:1,message:'old'});writer.history();
 state.combatLogs.W=[];writer.historyNow();
 assert.equal(writes.length,1);assert.deepEqual(writes[0][1].combatLogs.W,[]);
 t.mock.timers.tick(HISTORY_SAVE_MS);assert.equal(writes.length,1);
});
test('a failed timed history save is reported, stays pending and succeeds on flush',t=>{
 let fail=true;const writes=[];
 const {state,writer}=historyFixture(t,{set(key,value){if(fail)throw Error('disk full');writes.push([key,JSON.parse(JSON.stringify(value))]);}});
 const errors=t.mock.method(console,'error',()=>{});
 state.combatLogs.W.push({at:1,message:'kept'});writer.history();
 assert.doesNotThrow(()=>t.mock.timers.tick(HISTORY_SAVE_MS));
 assert.equal(errors.mock.callCount(),1);assert.equal(writes.length,0);
 fail=false;writer.flush();
 assert.equal(writes.length,1);assert.equal(writes[0][1].combatLogs.W[0].message,'kept');
});
test('a pending history save does not keep the process alive',()=>{
 const {spawnSync}=require('node:child_process');
 const script=`const {createCoordinatorPersistence}=require('./runtime/coordinator/persistence/writer.ts');const w=createCoordinatorPersistence({aldata:{},merchantActivity:[],combatLogs:{}},{set(){}});w.history();`;
 const started=Date.now();const result=spawnSync(process.execPath,['--experimental-strip-types','-e',script],{timeout:20000});
 assert.equal(result.status,0,String(result.stderr));assert.ok(Date.now()-started<HISTORY_SAVE_MS,'exit does not wait for the history timer');
});
test('clearing a combat log saves history at once',()=>{
 const {createCombatLogRoutes}=require('../../runtime/coordinator/telemetry/combat-log.ts');
 const calls=[],routes={};
 const logs={W:[{at:1,message:'old'}]};
 createCombatLogRoutes(logs,{owned:()=>true,now:()=>1,persist:()=>calls.push('later'),persistNow:()=>calls.push('now')})
  .install({post:(path,handler)=>{routes[path]=handler;}});
 const response={status(){return this;},json(body){return body;}};
 routes['/party-api/combat-log']({body:{character:'W',events:[{message:'new'}]}},response);
 routes['/party-api/combat-log/:character/clear']({params:{character:'W'}},response);
 assert.deepEqual(calls,['later','now']);assert.deepEqual(logs.W,[]);
});
