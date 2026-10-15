import { test, expect } from './live-fixtures';
import type { LiveGame } from './live-fixtures';

// Failure inventory: e2e/giveaway-locate-failures.md (#129). The host is the priest with
// its party CODE stopped: it walks, opens a stand and lists a real giveaway natively.
// Declared inputs: a stand0 in the host's bag and, in the directory journey, one entry in
// the game's merchant directory. The directory lists only merchant-class stands and an
// account can have only one merchant online, so the real /api/pull_merchants response
// gains the priest's stand, built from the priest's live server position.
const merchant = 'E2EMerchant';

const hostSlot = (live: LiveGame, host: string) => live.admin(`output=(()=>{const p=get_player('${host}');const s=p&&p.slots.trade1;
  return s?{name:s.name,giveaway:s.giveaway,rid:s.rid,list:s.list||[]}:null;})()`);
const activity = async (live: LiveGame, text: string) =>
  ((await live.state()).merchantActivity || []).filter((entry: any) => String(entry.message).includes(text));

async function hostGiveaway(live: LiveGame, host: string, at: { map: string; x: number; y: number }, minutes: number) {
  const client = live.clients[host];
  await client.run('clearInterval(globalThis.__partyPassiveRegenTimer);globalThis.partyRoleRunner.stop();true');
  await expect(async () => {
    await client.run(`smart_move(${JSON.stringify(at)}).then(()=>true,()=>false)`);
    const c = await client.snapshot();
    expect(c.map === at.map && Math.hypot(c.x - at.x, c.y - at.y) <= 30).toBe(true);
  }).toPass({ timeout: 120_000 });
  const tool = await live.admin(`output=(()=>{const p=get_player('${host}');const i=p.items.findIndex((it,n)=>!it&&n<42);
    if(i<0)throw Error('Host needs a free bag cell');p.items[i]={name:'stand0'};
    if(!p.items.some(it=>it&&it.name==='hpot1')){const j=p.items.findIndex((it,n)=>!it&&n<42);if(j<0)throw Error('Host needs a second free cell');p.items[j]={name:'hpot1',q:10};}
    cache_player_items(p);resend(p,'reopen+cid');return i;})()`);
  expect(tool).toBeGreaterThanOrEqual(0);
  await expect.poll(() => client.run(`character.items.some(i=>i&&i.name==='stand0')`)).toBe(true);
  await client.run('open_stand().then(()=>true)');
  await expect.poll(() => client.run('!!character.stand')).toBe(true);
  await client.run(`parent.giveaway('trade1',character.items.findIndex(i=>i&&i.name==='hpot1'),1,${minutes}).then(()=>true)`);
  await expect.poll(async () => (await hostSlot(live, host))?.giveaway).toBe(minutes);
}

/** A walkable spot on the host's map at least `min` and at most `max` pixels from `from`. */
async function spot(live: LiveGame, from: { map: string; x: number; y: number }, min: number, max: number) {
  // Prefer a spot with a straight line back to the market; any walkable cell is the fallback.
  return live.admin(`output=(()=>{const f=${JSON.stringify(from)};
    const open=(x,y,straight)=>{const body={type:'character',map:f.map,x,y};set_base(body);const cell=smap_data[f.map]===-1?0:smap_data[f.map]?.[rphash(x,y)];
      return can_move({...body,going_x:x,going_y:y})&&cell<2&&(!straight||can_move({...body,going_x:f.x,going_y:f.y}));};
    for(const straight of [true,false])for(let r=${min};r<=${max};r+=40)for(let a=0;a<16;a++){
      const x=Math.round(f.x+r*Math.cos(a*Math.PI/8)),y=Math.round(f.y+r*Math.sin(a*Math.PI/8));if(open(x,y,straight))return {map:f.map,x,y};}
    throw Error('No walkable host spot');})()`);
}

test('a giveaway host away from the market is found through the merchant directory and joined from the bank', async ({ live, page }, info) => {
  test.setTimeout(420_000);
  const host = 'E2EPriest', samples: any[] = [], directory: any[] = [];
  try {
    await expect.poll(async () => Date.now() - ((await live.state()).characters[merchant]?.seenAt || 0), { timeout: 90_000 }).toBeLessThan(3_000);
    const state = await live.state(), market = state.merchantStandLocation;
    // 1: the stand is far enough from the market spot that the merchant cannot see it there.
    const at = await spot(live, market, 1100, 1700);
    await hostGiveaway(live, host, at, 30);
    await live.clients[merchant].page.route('**/api/pull_merchants', async route => {
      const response = await route.fetch(), body = await response.json();
      const stand = await live.admin(`output=(()=>{const p=get_player('${host}');return {name:p.name,map:p.map,x:p.x,y:p.y,server:server_id,stand:p.p.stand,level:p.level};})()`);
      const infs = Array.isArray(body.infs) ? body.infs : (body.infs = []);
      const listing = infs.find((entry: any) => entry?.type === 'merchants') || (infs.push({ type: 'merchants', chars: [] }), infs.at(-1));
      listing.chars.push(stand);
      directory.push({ at: Date.now(), native: listing.chars.length - 1, declared: stand });
      await route.fulfill({ response, json: body });
    });
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'join giveaway': true } });
    const realm = (await live.state()).giveawayRealms.find((entry: any) => entry.key === state.activeRealm) || (await live.state()).giveawayRealms[0];
    await page.goto(live.url);
    const card = page.locator('article').filter({ has: page.getByRole('heading', { name: merchant, exact: true }) });
    await card.getByRole('button', { name: 'Join giveaway', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Join giveaway' });
    await dialog.getByRole('combobox').first().click();
    await page.getByRole('option', { name: realm.label, exact: true }).click();
    await dialog.getByRole('button', { name: 'Search online players' }).click();
    await page.getByPlaceholder('Search player name…').fill(host);
    await page.getByRole('option', { name: new RegExp(`^(Use “)?${host}(”)?$`) }).first().click();
    // 2: queued behind a real bank visit, the join is dispatched while the merchant is inside the bank.
    await live.post('/command', { character: merchant, type: 'bank' });
    await dialog.getByRole('button', { name: 'Join', exact: true }).click();
    await expect.poll(async () => (await activity(live, `Queued giveaway search for ${host}`)).length, { timeout: 20_000 }).toBeGreaterThan(0);
    // 5: the server lists the merchant on the host's slot.
    await expect.poll(async () => {
      const [slot, c, s] = await Promise.all([hostSlot(live, host), live.clients[merchant].snapshot(), live.state()]);
      samples.push({ at: Date.now(), slot, merchant: { map: c.map, x: c.x, y: c.y }, current: s.merchantCurrent?.reason || null });
      const failed = (s.merchantActivity || []).find((entry: any) => entry.message === 'Giveaway entry failed');
      if (failed) throw new Error('Giveaway entry failed: ' + failed.details);
      return slot?.list || [];
    }, { timeout: 240_000, intervals: [500] }).toContain(merchant);
    const merchantAt = samples.find(sample => sample.current === 'join giveaway');
    expect(merchantAt?.merchant.map, 'The join must start inside the bank').toBe('bank');
    expect(await activity(live, `Joined 1 giveaway from ${host}`)).not.toHaveLength(0);
    expect(directory.length, 'The merchant must look the host up in the directory').toBeGreaterThan(0);
    const bankRefusals = (await live.clients[merchant].events()).filter((event: any) => JSON.stringify(event).includes('cant_in_bank'));
    expect(bankRefusals).toEqual([]);
    await info.attach('giveaway-located-and-joined', { body: JSON.stringify({ market, host: at, merchantStart: merchantAt, directory, slot: await hostSlot(live, host),
      activity: (await live.state()).merchantActivity?.slice(-30), samples }, null, 2), contentType: 'application/json' });
  } catch (error) {
    await info.attach('giveaway-locate-failure', { body: JSON.stringify({ samples, directory, activity: (await live.state()).merchantActivity?.slice(-40) }, null, 2), contentType: 'application/json' });
    throw error;
  }
});

test('an expired giveaway job warns, releases its claim and the still-running giveaway is queued and joined', async ({ live }, info) => {
  test.setTimeout(900_000);
  const host = 'E2EPriest', samples: any[] = [];
  try {
    await expect.poll(async () => Date.now() - ((await live.state()).characters[merchant]?.seenAt || 0), { timeout: 90_000 }).toBeLessThan(3_000);
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'join giveaway': true } });
    // Force stand holds every merchant job while the merchant keeps observing its surroundings.
    // A stand tool keeps the held merchant from retrying a stand it cannot open.
    expect(await live.admin(`output=(()=>{const p=get_player('${merchant}');const i=p.items.findIndex((it,n)=>!it&&n<42);
      p.items[i]={name:'stand0'};cache_player_items(p);resend(p,'reopen+cid');return i;})()`)).toBeGreaterThanOrEqual(0);
    await live.post('/merchant/force-stand', { enabled: true });
    const market = (await live.state()).merchantStandLocation;
    await expect.poll(async () => {
      const c = await live.clients[merchant].snapshot();
      return c.map === market.map && Math.hypot(c.x - market.x, c.y - market.y) <= 40;
    }, { timeout: 120_000 }).toBe(true);
    const at = await spot(live, market, 80, 200);
    await hostGiveaway(live, host, at, 5);
    const listedAt = Date.now();
    await expect.poll(async () => (await activity(live, `Discovered giveaway from ${host}`)).length, { timeout: 60_000 }).toBe(1);
    const queued = (await live.state()).merchantQueue.find((job: any) => job.reason === 'join giveaway' && job.seller === host);
    // 6: expiry follows the giveaway's five remaining minutes.
    expect(queued?.expiresAt - queued?.queuedAt).toBeGreaterThan(4 * 60_000);
    expect(queued?.expiresAt - queued?.queuedAt).toBeLessThanOrEqual(5 * 60_000 + 5_000);
    // 7, 8, 9: a warning, a fresh job queued after it, never two queued copies.
    let warning: any = null, requeued: any = null;
    await expect.poll(async () => {
      const s = await live.state(), jobs = [s.merchantCurrent, ...s.merchantQueue].filter((job: any) => job?.reason === 'join giveaway' && job.seller === host);
      const warnings = (s.merchantActivity || []).filter((entry: any) => entry.message === `Giveaway from ${host} expired before the merchant could join`);
      warning ||= warnings[0] || null;
      samples.push({ at: Date.now(), copies: jobs.length, jobs: jobs.map((job: any) => ({ id: job.id, queuedAt: job.queuedAt, expiresAt: job.expiresAt })),
        warnings: warnings.length, slot: await hostSlot(live, host) });
      expect(jobs.length).toBeLessThanOrEqual(1);
      expect(warnings.length).toBeLessThanOrEqual(1);
      requeued = warning && jobs.find((job: any) => job.id !== queued.id && job.queuedAt >= warning.at) || null;
      return !!requeued;
    }, { timeout: 480_000, intervals: [3000] }).toBe(true);
    expect(warning.level).toBe('warning');
    expect(warning.at - listedAt).toBeGreaterThan(4 * 60_000);
    expect(JSON.stringify(warning.details)).toContain('hpot1');
    await live.post('/merchant/force-stand', { enabled: false });
    await expect.poll(async () => (await hostSlot(live, host))?.list || [], { timeout: 180_000, intervals: [2000] }).toContain(merchant);
    await info.attach('giveaway-expiry-requeue', { body: JSON.stringify({ market, host: at, listedAt, queued, warning, requeued, slot: await hostSlot(live, host),
      activity: (await live.state()).merchantActivity?.slice(-30), samples }, null, 2), contentType: 'application/json' });
  } catch (error) {
    await info.attach('giveaway-expiry-failure', { body: JSON.stringify({ samples, activity: (await live.state()).merchantActivity?.slice(-40) }, null, 2), contentType: 'application/json' });
    throw error;
  }
});
