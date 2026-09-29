import { test, expect } from './live-fixtures';
import { warrior as W, priest as P, fighters, world, tokens, profile, party, quests, start, artifact } from './game/hunt-lifecycle';

// Faults exercise the actual browser transport; no status, route or acknowledgement is fabricated.
for (const fault of ['completion-request', 'completion-response', 'follower-reconnect'] as const) {
  test(`native Hunt survives ${fault} loss and both owners receive exactly one Daisy reward`, async ({ live }, info) => {
    test.setTimeout(300_000);
    await party(live);
    const questCount = fault === 'follower-reconnect' ? 12 : 3;
    await quests(live, info, { [W]: { count: questCount }, [P]: { count: questCount } });
    const before = await world(live);
    const faults: unknown[] = [];
    let intercepted = false;
    const context = live.clients[W].page.context();
    const rendezvousReports: unknown[] = [];
    const inspectStatus = (request: import('@playwright/test').Request) => {
      if (fault !== 'follower-reconnect' || request.method() !== 'POST' || !request.url().endsWith('/party-api/status')) return;
      const body = request.postDataJSON();
      if (body.name === P && body.convoyNavigation?.phase === 'rendezvous') rendezvousReports.push({ at: Date.now(), report: body.convoyNavigation });
    };
    context.on('request', inspectStatus);
    if (fault !== 'follower-reconnect') {
      await context.route('**/party-api/convoy-complete', async route => {
        const packet = route.request().postDataJSON();
        if (intercepted || packet.character !== P) return route.fallback();
        intercepted = true;
        if (fault === 'completion-response') {
          const response = await route.fetch();
          faults.push({ fault, packet, acceptedResponse: await response.json() });
        } else faults.push({ fault, packet });
        await route.abort('connectionreset');
      });
    }
    await start(live);
    await expect.poll(async () => profile(await live.state()).monsterHunt?.cycleId).toBeTruthy();
    const cycle = profile(await live.state()).monsterHunt.cycleId;
    if (fault === 'follower-reconnect') {
      await expect.poll(async () => (await world(live))[W].quest?.c, { timeout: 120_000 }).toBeLessThan(questCount);
      const beforeReconnect = await world(live);
      const previousRuntime = (await live.state()).characters[P]?.combatSelection?.runtimeId;
      expect(previousRuntime).toBeTruthy();
      expect(beforeReconnect[W].quest?.c, 'Disconnect must interrupt an unfinished native Hunt').toBeGreaterThan(0);
      faults.push({ fault, beforeReconnect });
      await live.reconnectClient(P);
      expect((await live.clients[P].snapshot()).name).toBe(P);
      await expect.poll(async () => {
        const runtime = (await live.state()).characters[P]?.combatSelection?.runtimeId;
        return !!runtime && runtime !== previousRuntime;
      }, {timeout:30_000,message:'The coordinator must observe the reconnected follower runtime'}).toBe(true);
    } else await expect.poll(() => intercepted, { timeout: 120_000 }).toBe(true);
    await expect.poll(async () => {
      const current = await world(live);
      return fighters.every(name => tokens(current[name]) === tokens(before[name]) + 1);
    }, { timeout: 180_000 }).toBe(true);
    if (fault === 'follower-reconnect') {
      // A follower still at the group can recover directly without a rendezvous
      // leg. When it does need that leg, its actual reports must identify it.
      expect(rendezvousReports.every((entry: any) => entry.report.routeVersion > 0), 'Rendezvous must publish its issued route version before awaiting native travel').toBe(true);
    }
    await live.post('/farming-mode', { character: W, mode: 'default' });
    await live.restartCoordinator();
    const after = await world(live);
    for (const name of fighters) expect(tokens(after[name])).toBe(tokens(before[name]) + 1);
    context.off('request', inspectStatus);
    await artifact(live, info, 'hunt-native-communication-recovery', { cycle, before, faults, rendezvousReports });
  });
}
