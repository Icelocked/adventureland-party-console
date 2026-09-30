import { test, expect } from './live-fixtures';

const merchant = 'E2EMerchant';

test.describe('stale merchant recovery', () => {
  test.setTimeout(300_000);

  test('automatic missing sale marks expire while manual and locked marks survive restart', async ({ live }, info) => {
    // Failure modes: unchanged-inventory cache prevents GC; manual intent is
    // discarded; locked stock expires; restart resets the original blocked clock.
    const blockedAt = Date.now() - 299_000;
    const inventory = (await live.state()).characters[merchant].items;
    const blockedInventory = JSON.stringify(inventory.map((entry: { slot: number; item: unknown } | null) => entry && [entry.slot, entry.item]));
    const base = { source: 'merchant', slot: 20, item: { name: 'helmet', level: 0 }, quantity: 1, state: 'blocked', blockedAt, blockedInventory };
    await live.restoreHistoricalSettings(() => ({ npcSaleMarks: [
      { ...base, id: 'old-auto', auto: true, error: 'Marked item is not in merchant inventory' },
      { ...base, id: 'manual', auto: false, error: 'Marked item is not in merchant inventory' },
    ] }));
    await expect.poll(async () => (await live.state()).npcSaleMarks.map((mark: { id: string }) => mark.id)).toEqual(['manual']);
    await live.admin(`output=(()=>{const p=get_player('${merchant}');p.items[20]={name:'helmet',level:0,l:'l'};cache_player_items(p);resend(p,'reopen+cid');return p.items;})()`);
    await expect.poll(async () => (await live.clients[merchant].snapshot()).items[20]?.l).toBe('l');
    await live.restoreHistoricalSettings(() => ({ npcSaleMarks: [
      { ...base, id: 'locked-auto', auto: true, error: 'Item is locked' },
      { ...base, id: 'manual', auto: false, error: 'Marked item is not in merchant inventory' },
    ] }));
    await expect.poll(async () => (await live.state()).npcSaleMarks.find((mark: { id: string }) => mark.id === 'locked-auto')?.error).toBe('Item is locked');
    await live.restartCoordinator();
    await expect.poll(async () => (await live.state()).npcSaleMarks.length).toBe(2);
    await info.attach('retained-sale-intent', { body: JSON.stringify(await live.state()), contentType: 'application/json' });
  });

  test('stale bank confirmation preserves reused inventory and permits native travel', async ({ live }, info) => {
    // Failure modes: stale journal blocks status/commands; recovery moves an
    // unrelated item; an uncertain transfer is replayed; recovery loops forever.
    await live.admin(`output=(()=>{const p=get_player('${merchant}');p.items[20]={name:'helmet',level:0};cache_player_items(p);resend(p,'reopen+cid');return p.items;})()`);
    await expect.poll(async () => (await live.clients[merchant].snapshot()).items[20]?.name).toBe('helmet');
    await live.clients[merchant].run(`(()=>{const journal={buffers:[{slot:20,identity:JSON.stringify(['leather',0,null,null,null,null,null,null,null]),source:21}],pending:[{inventory:20,item:null}],recoveryStartedAt:Date.now()-31000};localStorage.setItem('party-bank-stack-buffer:'+character.name,JSON.stringify(journal));window.__partyBankStackJournal=journal;return journal;})()`);
    await live.post('/command', { character: merchant, type: 'character-travel', location: { map: 'main', x: 250, y: 0 } });
    await expect.poll(async () => (await live.clients[merchant].snapshot()).x, { timeout: 90_000 }).toBeGreaterThan(200);
    expect((await live.clients[merchant].snapshot()).items[20]).toMatchObject({ name: 'helmet', level: 0 });
    await live.post('/command', { character: merchant, type: 'mark', slot: 20, item: { name: 'helmet', level: 0 } });
    await live.post('/command', { character: merchant, type: 'bank' });
    await expect.poll(async () => (await live.clients[merchant].snapshot()).items[20], { timeout: 90_000 }).toBeNull();
    await expect.poll(() => live.clients[merchant].run('window.__partyBankStackJournal')).toBeNull();
    const stored = await live.admin(`output=(()=>{const p=get_player('${merchant}');return Object.entries(p.user).filter(([key,value])=>/^items[0-9]+$/.test(key)&&Array.isArray(value)).flatMap(([,items])=>items).filter(item=>item&&item.name==='helmet'&&item.level===0);})()`);
    expect(stored).toHaveLength(1);
    await info.attach('stale-bank-native-travel', { body: JSON.stringify({ client: await live.clients[merchant].snapshot(), state: await live.state(), events: await live.clients[merchant].events() }), contentType: 'application/json' });
  });

  test('offline merchant work permits stale-status login and times out without a heartbeat', async ({ live }, info) => {
    // Failure modes: expiry needs a worker heartbeat; retries run forever;
    // stale assigned work blocks the native ownership/login recovery path.
    const context = live.clients[merchant].page.context();
    let allowOneReport = false;
    await context.route('**/party-api/status', async route => {
      if (route.request().postDataJSON()?.name === merchant) {
        if (allowOneReport) { allowOneReport = false; await route.fetch(); }
        return route.abort('connectionfailed');
      }
      return route.fallback();
    });
    await live.restoreHistoricalSettings(() => ({ merchantCurrent: {
      id: 'offline-exhausted', target: merchant, reason: 'manual bank exchange',
      phase: 'assigned', startedAt: Date.now() - 181_000, recoveryAttempts: 3,
    } }));
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'manual bank exchange': true } });
    // Restart restores the old intent into the queue. Admit one native report
    // to assign it, drop its response, then withhold every further worker report.
    allowOneReport = true;
    await expect.poll(async () => (await live.state()).merchantCurrent?.id, { timeout: 20_000 }).toBe('offline-exhausted');
    const assigned = await live.state();
    await expect.poll(() => Date.now() - assigned.merchantCurrent.startedAt).toBeGreaterThan(7000);
    // Exercise the real roster action guard while the job still exists. This
    // checks the busy guard; the already assigned native session stays connected.
    // Reaching the assignment conflict proves stale work did not block admission.
    const response = await fetch(live.url + '/party-api/steam/action', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: live.url },
      body: JSON.stringify({ character: merchant, action: 'login' }) });
    const login = { status: response.status, body: await response.json() };
    expect(login.status).toBe(409);
    expect(login.body.error).toContain('Character is already assigned');
    await expect.poll(async () => (await live.state()).merchantCurrent, { timeout: 200_000 }).toBeNull();
    const timedOut = await live.state();
    expect(timedOut.merchantQueue.some((job: { id: string }) => job.id === 'offline-exhausted')).toBe(false);
    await context.unroute('**/party-api/status');
    await expect.poll(async () => (await live.clients[merchant].snapshot()).statusAt, { timeout: 30_000 }).toBeGreaterThan(Date.now() - 5000);
    await info.attach('offline-merchant-timeout-and-login', { body: JSON.stringify({ assigned, login, timedOut, recovered: await live.state() }), contentType: 'application/json' });
  });
});
