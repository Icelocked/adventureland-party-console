import { test, expect } from './live-fixtures';
import history from './game/franky-recovery-history.json' with { type: 'json' };

const W = 'E2EWarrior';
const tokens = (player: any) => player.items.reduce((sum: number, item: any) => sum + (item?.name === 'monstertoken' ? item.q || 1 : 0), 0);

test('restored acknowledged Franky exit resumes completed gscorpion Hunt from desertland while the boss remains alive', async ({ live }, info) => {
  test.setTimeout(360_000);
  await live.post('/formation', { leader: W });
  await live.post('/command', { character: W, type: 'character-travel', location: { map: 'desertland', x: 0, y: 0 }, label: 'Historical recovery starting position' });
  await expect.poll(async () => { const c=(await live.state()).characters[W];return c?.map==='desertland' && !c.moving; }, { timeout: 120_000 }).toBe(true);
  await live.admin(`output=(()=>{const p=get_player('${W}');p.s.monsterhunt={sn:region+' '+server_name,id:'gscorpion',c:0,ms:1800000};resend(p,'u+cid+reopen');events.franky=true;delete timers.franky;return p.s.monsterhunt})()`);
  const observed = () => live.admin(`output=(()=>{const p=get_player('${W}');return {franky:!!E.franky?.live,boss:!!get_monster('franky'),map:p.map,quest:p.s.monsterhunt||null,items:p.items}})()`);
  await expect.poll(async () => {const world=await observed();return world.franky&&world.boss;}, { timeout: 30_000 }).toBe(true);
  const initial = await observed(), beforeTokens=tokens(initial);
  expect(initial.map).toBe('desertland');
  await live.restoreHistoricalSettings(settings => {
    const now=Date.now(), intent=settings.navigationIntents[W];
    if (!intent || !Number.isFinite(intent.revision)) throw Error('Native travel must persist a navigation revision');
    const location=structuredClone(history.location);
    const monsterHunt={...structuredClone(history.monsterHunt),cycleId:'historical-hunt-'+now,startedAt:now-120_000,
      message:'Restored captured completed quest after acknowledged Franky exit',eventTrips:{[W]:[{event:'franky',startedAt:now-90_000}]}};
    const eventReturn={...structuredClone(history.eventReturn),cycleId:'historical-franky-'+now,startedAt:now-60_000,
      waypoints:{[W]:{revision:intent.revision,location}},exitConvoyId:'historical-completed-exit'};
    return {
      characterLocations:{...settings.characterLocations,[W]:location},location,farmingPolicy:'hunt',
      farmingProfiles:{...settings.farmingProfiles,[W]:{...settings.farmingProfiles?.[W],farmingPolicy:'hunt',monsterHunt,eventReturn,location,monsterFocus:['gscorpion'],activeConvoy:null}},
      eventSelectionsByCharacter:{...settings.eventSelectionsByCharacter,[W]:[]},activeConvoy:null,deferredEventReturns:{},
      eventReturn,
      monsterHunt
    };
  });
  await info.attach('historical-recovery-provenance', { body: JSON.stringify({provenance:history.provenance,initial}), contentType:'application/json' });
  await expect.poll(async () => { const state=await live.state();return !state.eventReturn && state.monsterHunt?.stage!=='paused-event' && Date.now()-state.characters[W]?.seenAt<3000; }, { timeout:30_000, intervals:[100], message:'An acknowledged historical exit must resume Hunt without another Main arrival' }).toBe(true);
  const handoff=await observed();
  await info.attach('franky-handoff-position', { body:JSON.stringify({observedAt:Date.now(),handoff,state:await live.state()}),contentType:'application/json' });
  expect(handoff.map).toBe('desertland');
  await expect.poll(async () => tokens(await observed()), { timeout:180_000, message:'Native Hunt must claim the actual completed gscorpion reward at Daisy' }).toBe(beforeTokens+1);
  const final=await observed();
  expect(final.map).toBe('main');
  expect(final.franky&&final.boss).toBe(true);
  expect((await live.state()).eventSelectionsByCharacter[W]).not.toContain('franky');
  await info.attach('franky-restored-hunt-reward', { body:JSON.stringify({final,state:await live.state()}),contentType:'application/json' });
});
