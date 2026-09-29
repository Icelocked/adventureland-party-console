import { test, expect } from './live-fixtures';
import { warrior as W, priest as P, world, tokens, profile, location, party, quests, start, artifact, rejected } from './game/hunt-lifecycle';

test('saved follower Hunt preferences and cleared backup focus preserve the active leader quest through real reward', async ({ live }, info) => {
  test.setTimeout(300_000);
  await party(live);
  const destination = await location(live);
  const backup = { monsterFocus: ['goo'], location: destination };
  await live.post('/farming-mode', { character: P, mode: 'hunt', backup });
  expect(profile(await live.state(), P).monsterHunt).toBeFalsy();
  expect(profile(await live.state(), W).monsterHunt).toBeFalsy();
  const merchant = await rejected(live, '/farming-mode', { character: 'E2EMerchant', mode: 'hunt', backup });
  expect(merchant.status).toBe(409);
  await quests(live, info, { [W]: { count: 4 }, [P]: { count: 4 } });
  const before = await world(live);
  await start(live);
  const cycle = profile(await live.state()).monsterHunt.cycleId;
  await live.post('/focus', { character: W, monsterFocus: [] });
  expect(profile(await live.state()).monsterHunt.cycleId).toBe(cycle);
  await expect.poll(async () => tokens((await world(live))[W]), { timeout: 180_000 }).toBe(tokens(before[W]) + 1);
  await artifact(live, info, 'follower-preference-and-cleared-backup-real-reward', { before, cycle, merchant });
});
