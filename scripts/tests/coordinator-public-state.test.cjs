const test=require('node:test');
const assert=require('node:assert/strict');
const {publicStateRuntime}=require('./helpers/coordinator-public-state.cjs');
test('pending command projection preserves empty entries and excludes absent values from JSON',()=>{
 const {pendingCommands}=require('../../runtime/coordinator/telemetry/public-state-characters.ts');
 const command={id:7,type:'travel',privateValue:'keep private'},state={missing:undefined,empty:null,P:command};
 const output=pendingCommands(state);
 assert.equal(Object.hasOwn(output,'missing'),true);assert.equal(output.missing,undefined);
 assert.deepEqual(JSON.parse(JSON.stringify(output)),{empty:null,P:{id:7,type:'travel',phase:null,convoyId:null}});
 assert.equal(state.P,command);assert.equal(command.privateValue,'keep private');
});
function read(r,query){let result;r.route({query},{json:value=>{result=value;}});return JSON.parse(JSON.stringify(result));}

test('dashboard config and core partition settings without slowing live progress or changing legacy core', () => {
 const r=publicStateRuntime();
 const core=read(r,{section:'core',dashboard:'1'}), config=read(r,{section:'config',dashboard:'1'});
 for(const field of ['threshold','marked','monsterFocus','huntSettings','merchantRules']) {
  assert.equal(Object.hasOwn(core,field),false,field);
  assert.deepEqual(config[field],r.party[field]);
 }
 for(const field of ['monsterHunt','activeConvoy','anniversary','activeSlots','gameVersion','clientUpdate','nativeStand','partyFarmingMode']) {
  assert.ok(Object.hasOwn(core,field),field);
  assert.equal(Object.hasOwn(config,field),false,field);
 }
 assert.deepEqual(read(r,{section:'core'}).threshold,r.party.threshold);
 assert.deepEqual(read(r,{}).marked,r.party.marked);
 for(const field of Object.keys(config)) assert.equal(Object.hasOwn(core,field),false,field);
});

test('fresh headless telemetry supersedes a lost Steam observation after handoff',()=>{
 const r=publicStateRuntime();
 require('../../runtime/roster/connection-status.ts').recordConnections(r.party,
  [{name:'P',primary:false,state:'waiting'}],r.ports.now()-30000);
 r.party.statuses.P.runtime='headless';
 for(const query of [{},{section:'core',dashboard:'1'}]) {
  const connection=read(r,query).characterConnections[0];
  assert.equal(connection.status,'connected');
  assert.equal(connection.delayed,false);
 }
 r.party.statuses.P.seenAt=r.ports.now()-5000;
 assert.equal(read(r,{}).characterConnections[0].status,'lost');
 r.party.statuses.P.runtime='native';
 r.party.statuses.P.seenAt=r.ports.now();
 assert.equal(read(r,{}).characterConnections[0].status,'connected');
});

test('inventory presentation trims metadata without mutating the live inventory',()=>{
 const r=publicStateRuntime(),before=JSON.stringify(r.party.statuses.P.items);
 const value=read(r,{section:'inventory'});assert.equal(value.characters.P.items[0].meta.unneeded,undefined);
 assert.equal(value.characters.P.items[0].meta.sprite,'sprite');assert.equal(JSON.stringify(r.party.statuses.P.items),before);
 const full=read(r,{});assert.equal(full.characters.P.items[0].meta.unneeded,'omit-me');
});

test('overview does not expose unlisted private state and unknown sections retain full responses',()=>{
 const r=publicStateRuntime();r.party.sessionToken='never expose';r.party.worker={pid:123};
 const value=read(r,{section:'constructor'});assert.equal(value.sessionToken,undefined);assert.equal(value.worker,undefined);
 assert.deepEqual(value.giveawayPlayers.SR_USII,['Alice','Bob','Trader']);assert.equal(value.characters.P.name,'P');
});
