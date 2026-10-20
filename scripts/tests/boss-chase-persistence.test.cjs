// Ways the boss chase can waste or lose settings saves, or change what clients
// read, written before the change:
// 1. A poll whose only changes are the latest ALData observation (sightings,
//    respawns, checkedAt, lastError) writes a new settings record. The poll
//    runs every 60 s, so the whole settings document goes to the journal once
//    a minute while any chased boss is selected.
// 2. A trip poll that changes nothing a restart restores still asks for a
//    settings save, so the writer serializes every settings field for nothing.
// 3. The saved record drops a field that initialBossChase restores (enabled,
//    minEtaMinutes, trip, returning), so a restart forgets a trip or a
//    pending return home.
// 4. The config section's bossChase loses a field or gains a key. The
//    dashboard, the PWA (RealmChaseSettings.tsx) and the Android app
//    (RealmChaseSettings.kt) read sightings, respawns, checkedAt and lastError
//    from it.
// 5. A settings record saved before the change, with the whole bossChase
//    object under its own key, no longer loads.
// The retry delay after a refused switch (retryAt) is covered by
// chase-return.test.cjs.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createBossChase,initialBossChaseFields}=require('../../runtime/coordinator/events/boss-chase.ts');
const {createCoordinatorPersistence}=require('../../runtime/coordinator/persistence/writer.ts');
const {stateKeys}=require('../../runtime/coordinator/persistence/snapshots.ts');
const {publicStateRuntime}=require('./helpers/coordinator-public-state.cjs');

const MIN=60_000, HOME='SR_USII', AWAY='SR_USV';
const publicKeys=['checkedAt','enabled','lastError','minEtaMinutes','respawns','retryAt','returning','sightings','trip'];
/**
 * One party for the boss chase, the real settings writer and the real public
 * state route. The store records each settings record the writer sends.
 */
function fixture(drain) {
  let time=1_000_000, realm=HOME, crab=960_000;
  const runtime=publicStateRuntime(), party=runtime.party;
  Object.assign(party,initialBossChaseFields({bossChase:{enabled:true,minEtaMinutes:15}}));
  const records=[];
  const storage={set(){},setSerialized(key,json){if(key===stateKeys.settings)records.push(JSON.parse(json));}};
  const persistence=createCoordinatorPersistence(party,storage);
  let requests=0;
  const chase=createBossChase(party,{
    now:()=>time,
    fetchLive:async()=>[{type:'crabxx',id:'83862',hp:crab,lastSeen:new Date(time).toISOString(),serverRegion:'US',serverIdentifier:'V'}],
    currentRealm:()=>realm, homeRealm:()=>HOME, realmExists:()=>true, hopAllowed:()=>true, realmSwitchBusy:()=>false,
    selected:event=>event==='crabxx',
    switchRealm:async to=>{realm=to;return {ok:true};},
    log(){}, persist(){requests++;},
  });
  persistence.settings();
  return {party,records,realm:()=>realm,requests:()=>requests,
    config(){let value;runtime.route({query:{section:'config'}},{json:v=>{value=v;}});return JSON.parse(JSON.stringify(value));},
    /** One 60 s poll; then any other system's save request runs the settings writer, as the coordinator does. */
    async minute(){time+=MIN;crab=Math.max(1,crab-drain);await chase.tick();persistence.settings();}};
}

test('polls that only change the observation write no settings record, and config shows the observation', async()=>{
  const r=fixture(100_000); // ~9-minute ETK: below minEtaMinutes, so no trip starts
  const before=r.records.length;
  for(let i=0;i<5;i++) await r.minute();
  assert.equal(r.records.length-before,0,'settings records');
  const {bossChase}=r.config();
  assert.equal(bossChase.trip,null);
  assert.equal(bossChase.sightings.length,1);
  assert.equal(bossChase.sightings[0].realm,AWAY);
  assert.ok(bossChase.checkedAt>0);
});

test('the config section keeps every bossChase field and adds no key', async()=>{
  const r=fixture(16_000);
  for(let i=0;i<3;i++) await r.minute();
  const config=r.config();
  assert.deepEqual(Object.keys(config.bossChase).sort(),publicKeys);
  assert.deepEqual(config.bossChase,JSON.parse(JSON.stringify(r.party.bossChase)));
  assert.equal(Object.hasOwn(config,'bossChaseSaved'),false);
});

test('a trip poll that changes nothing a restart restores asks for no save', async()=>{
  const r=fixture(16_000); // ~60-minute ETK: worth a trip
  for(let i=0;i<4&&r.realm()!==AWAY;i++) await r.minute();
  assert.equal(r.realm(),AWAY);
  await r.minute(); // arrival: arrived and liveSince change
  const requests=r.requests(), records=r.records.length;
  for(let i=0;i<3;i++) await r.minute(); // inside the engage grace: nothing saved changes
  assert.ok(r.party.bossChase.trip?.arrived);
  assert.equal(r.requests()-requests,0,'save requests');
  assert.equal(r.records.length-records,0,'settings records');
});

test('the saved record holds exactly what a restart restores', async()=>{
  const r=fixture(16_000);
  for(let i=0;i<5;i++) await r.minute();
  const record=r.records.at(-1);
  assert.equal(Object.hasOwn(record,'bossChase'),false,'the in-memory object is not saved');
  assert.ok(record.bossChaseSaved.trip,'the trip is saved');
  assert.deepEqual(Object.keys(record.bossChaseSaved).sort(),['enabled','minEtaMinutes','returning','trip']);
  const restored=initialBossChaseFields(record).bossChase;
  for(const key of ['enabled','minEtaMinutes','trip','returning']) assert.deepEqual(restored[key],r.party.bossChase[key],key);
});

test('a record saved before the change, with bossChase whole, still loads', ()=>{
  const old={bossChase:{enabled:true,minEtaMinutes:20,trip:null,returning:{from:AWAY,to:HOME},retryAt:5,lastError:'x',checkedAt:9,
    sightings:[{boss:'crabxx',realm:AWAY,hp:1,etaMinutes:null,target:null}],respawns:[]}};
  const {bossChase,bossChaseSaved}=initialBossChaseFields(old);
  assert.deepEqual(bossChaseSaved,{enabled:true,minEtaMinutes:20,trip:null,returning:{from:AWAY,to:HOME}});
  assert.deepEqual({...bossChase,returning:bossChase.returning},{enabled:true,minEtaMinutes:20,trip:null,returning:{from:AWAY,to:HOME},
    retryAt:0,lastError:null,checkedAt:0,sightings:[],respawns:[]});
});
