import { test, expect } from './live-fixtures';
import { warrior as R, priest as P, location, quests, artifact } from './game/hunt-lifecycle';

test.use({ primaryClass: 'ranger' });

// Failure modes: a singleton leader receives no group; its first pre-heartbeat
// shot hides starvation; automatic Scatter masks the broken group; another
// fighter supplies the kills. Require native class, singleton membership,
// committed Goo authorization and continued native quest progress in Group mode.
test('a single ranger leader continuously farms native Goos in Group mode', async ({ live }, info) => {
  test.setTimeout(240_000);
  expect(await live.clients[R].run('character.ctype')).toBe('ranger');
  await live.post('/formation', { leader: R });
  await live.post('/formation', { character: P, follow: false });
  await live.post('/farming-mode', { character: R, mode: 'default' });
  await live.post('/focus', { character: R, monsterFocus: ['goo'] });
  const destination = await location(live);
  await quests(live, info, { [R]: { id: 'goo', count: 100 } });
  const samples: unknown[] = [];
  const start = Date.now();
  try {
    await expect.poll(async () => {
      const group = await live.clients[R].run('globalThis.__partyGroupedCombat');
      return group?.members;
    }, { timeout: 25_000, message: 'The native solo ranger must receive a singleton combat group' }).toEqual([R]);
    await live.post('/travel', destination);
    let firstKillsAt = 0, firstCount = 100, authorized = false;
    await expect.poll(async () => {
      const state = await live.state();
      const client = await live.clients[R].run('({group:globalThis.__partyGroupedCombat,count:character.s.monsterhunt?.c,statusAt:globalThis.__partyStatusSuccessAt})');
      samples.push({ at: Date.now(), mode: state.partyFarmingMode, policy: state.farmingPolicy, client });
      expect(state.leader).toBe(R);
      expect(state.followers[P]).toBe(false);
      expect(state.partyFarmingMode).toBe('default');
      expect(client.group?.members).toEqual([R]);
      authorized ||= !!client.group?.committed && client.group?.target?.mtype === 'goo';
      if (authorized && client.count <= 97 && !firstKillsAt) {
        firstKillsAt = Date.now(); firstCount = client.count;
      }
      return authorized && firstKillsAt > 0 && Date.now() - firstKillsAt >= 10_000 && client.count <= firstCount - 3;
    }, { timeout: 150_000, intervals: [250, 500], message: 'Authorized singleton combat must keep killing native Goos after its first kills' }).toBe(true);
    const server = await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(R)});return {ctype:p.type,quest:p.s.monsterhunt,hp:p.hp,x:p.x,y:p.y}})()`);
    expect(server.quest.c).toBeLessThanOrEqual(firstCount - 3);
    expect((await live.clients[R].events()).some(event => event.at >= start && event.event === 'hit')).toBe(true);
    await artifact(live, info, 'solo-ranger-native-goo-farming', { destination, server, firstKillsAt, firstCount, samples });
  } finally {
    await info.attach('solo-ranger-authorization-history', { body: JSON.stringify(samples), contentType: 'application/json' });
  }
});
