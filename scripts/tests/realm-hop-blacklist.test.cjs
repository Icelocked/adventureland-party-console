// Failure inventory: e2e/realm-hop-blacklist-failures.md. Chase choices need live
// ALData sightings, which the disposable E2E server cannot reach, so these drive
// both chases with simulated payloads and realm switching.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createBossChase,initialBossChaseFields}=require('../../runtime/coordinator/events/boss-chase.ts');
const {initialRealmHopBlacklist,realmHopAllowed}=require('../../runtime/coordinator/navigation/realm-hop-blacklist.ts');

const MIN=60_000, HOME='SR_USII';
const crab=(realm,hp)=>({type:'crabxx',id:realm,hp,serverRegion:'US',serverIdentifier:realm.replace('SR_US','')});

function bossFixture(blacklist) {
  let time=1_000_000, realm=HOME;
  const hp={SR_USIII:900_000,SR_USV:900_000}, switches=[], party=initialBossChaseFields({bossChase:{enabled:true,minEtaMinutes:15}});
  const chase=createBossChase(party,{
    now:()=>time,
    fetchLive:async()=>Object.entries(hp).map(([at,value])=>({...crab(at,value),lastSeen:new Date(time).toISOString()})),
    currentRealm:()=>realm, homeRealm:()=>HOME, realmExists:()=>true, hopAllowed:to=>realmHopAllowed(blacklist,to),
    realmSwitchBusy:()=>false, selected:event=>event==='crabxx',
    switchRealm:async to=>{switches.push(to);realm=to;return {ok:true};},
    log(){}, persist(){},
  });
  return {party,switches,realm:()=>realm,
    async minute(drains){time+=MIN;for(const [at,drain] of Object.entries(drains))hp[at]=Math.max(1,hp[at]-drain);await chase.tick();}};
}

test('boss chase never picks a blacklisted realm, even when its boss ranks first',async()=>{
  // USIII drains slower (longer ETK), so without the list it would be chosen.
  const r=bossFixture(['SR_USIII']);
  for(let i=0;i<3;i++) await r.minute({SR_USIII:15_000,SR_USV:20_000});
  assert.deepEqual(r.switches,['SR_USV']);
});

test('a boss chase trip on a realm that becomes blacklisted ends and returns home',async()=>{
  const blacklist=[], r=bossFixture(blacklist);
  for(let i=0;i<3;i++) await r.minute({SR_USIII:15_000,SR_USV:20_000});
  assert.deepEqual(r.switches,['SR_USIII']);
  blacklist.push('SR_USIII');
  await r.minute({SR_USIII:15_000,SR_USV:20_000});
  assert.equal(r.party.bossChase.trip,null);
  assert.deepEqual(r.switches,['SR_USIII',HOME],'the blacklisted home-away trip returns home');
});

test('boss chase still returns to a blacklisted home realm',async()=>{
  const blacklist=[HOME], r=bossFixture(blacklist);
  for(let i=0;i<3;i++) await r.minute({SR_USIII:15_000,SR_USV:20_000});
  assert.deepEqual(r.switches,['SR_USIII']);
  blacklist.push('SR_USIII');
  await r.minute({SR_USIII:15_000,SR_USV:20_000});
  assert.deepEqual(r.switches,['SR_USIII',HOME]);
});

test('a malformed saved list loads as an empty or deduplicated list',()=>{
  assert.deepEqual(initialRealmHopBlacklist(undefined),[]);
  assert.deepEqual(initialRealmHopBlacklist('SR_USIII'),[]);
  assert.deepEqual(initialRealmHopBlacklist(['SR_USIII',7,'SR_USIII',null]),['SR_USIII']);
  assert.equal(realmHopAllowed([],'SR_USIIIPVP'),false,'PVP is always excluded');
});
