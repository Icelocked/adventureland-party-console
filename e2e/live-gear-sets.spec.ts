import { test, expect, type LiveGame } from './live-fixtures';
import { location } from './game/hunt-lifecycle';
import { W, P, M } from './game/hunt-events';

// Failure inventory: e2e/gear-sets-failures.md. The designated tank wears its whole saved luck
// set at the kill (both rings and both earrings from identical copies), restores its tank set
// afterwards, and set members in its bag are never taken by an automatic compound rule, while
// three spare copies of the same ring still are (a compound needs three).
const LUCK: Record<string, string> = { ring1: 'ringofluck', ring2: 'ringofluck', earring1: 'mearring', earring2: 'mearring', orb: 'rabbitsfoot', amulet: 'spookyamulet' };
const SLOTS = Object.keys(LUCK);

async function worn(live: LiveGame) {
  return live.clients[W].run(`(${JSON.stringify(SLOTS)}).reduce((out,slot)=>{out[slot]=character.slots[slot]?character.slots[slot].name:null;return out},{})`);
}
async function bagCount(live: LiveGame, name: string) {
  return live.admin(`output=get_player(${JSON.stringify(W)}).items.filter(item=>item&&item.name===${JSON.stringify(name)}).length`);
}
/** Carried plus worn: the kill-time swap moves set members between the bag and the slots while combat continues. */
async function heldCount(live: LiveGame, name: string) {
  return live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)});return [...p.items,...Object.values(p.slots)].filter(item=>item&&item.name===${JSON.stringify(name)}).length})()`);
}
/** Equip by hand the way a player would, choosing the exact slot (both ring slots included). */
async function equipBy(live: LiveGame, wanted: Record<string, string | null>) {
  for (const [slot, name] of Object.entries(wanted)) {
    if (!name) continue;
    await live.clients[W].run(`(()=>{const i=character.items.findIndex(item=>item&&item.name===${JSON.stringify(name)});if(i<0)throw Error('missing ${name}');equip(i,${JSON.stringify(slot)});return true})()`);
    await expect.poll(async () => (await worn(live))[slot], { timeout: 10_000 }).toBe(name);
  }
}

test('the tank wears its whole luck set at the kill, restores its tank set, and set members are never compounded or banked', async ({ live, page }, info) => {
  test.setTimeout(480_000);
  const samples: any[] = [];
  try {
    await live.post('/formation', { leader: W, tank: W });
    await live.post('/formation', { character: P, follow: true });
    // Declared fixture: the luck pieces plus three spare Rings of Luck (one compound) in the tank's bag.
    const given = await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)});
      const add=['ringofluck','ringofluck','ringofluck','ringofluck','ringofluck','mearring','mearring','rabbitsfoot','spookyamulet'];
      for(const name of add){const i=p.items.findIndex(x=>!x);if(i<0)throw Error('bag full');p.items[i]={name,level:0};}
      cache_player_items(p);resend(p,'u+cid+reopen');return add})()`);
    await expect.poll(async () => bagCount(live, 'ringofluck'), { timeout: 30_000 }).toBe(5);

    // 1. Save the gear worn now as the tank set, then wear the luck pieces and save the luck set.
    const tankWorn = await worn(live);
    await expect.poll(async () => (await live.post('/gear-sets', { character: W, set: 'tank', action: 'save' }).catch((e: Error) => ({ error: e.message }))).ok,
      { timeout: 30_000 }).toBe(true);
    await equipBy(live, LUCK);
    await expect.poll(async () => { const slots = (await live.state()).characters[W]?.slots || {};
      return SLOTS.every(slot => slots[slot]?.item?.name === LUCK[slot]); }, { timeout: 15_000, message: 'The status report shows the whole luck set before saving' }).toBe(true);
    expect((await live.post('/gear-sets', { character: W, set: 'luck', action: 'save' })).ok).toBe(true);
    const saved = (await live.state()).gearSets?.[W];
    expect(Object.fromEntries(SLOTS.map(slot => [slot, saved?.luck?.slots?.[slot]?.name]))).toEqual(LUCK);

    // 2. Back into the tank gear: the luck pieces return to the bag (earrings and orb to empty slots).
    for (const slot of SLOTS) if (!tankWorn[slot]) await live.clients[W].run(`unequip(${JSON.stringify(slot)})`);
    await equipBy(live, tankWorn);
    await expect.poll(async () => bagCount(live, 'ringofluck'), { timeout: 15_000 }).toBe(5);

    // 3. An automatic compound rule for Rings of Luck and an Auto bank rule for the luck amulet, collected promptly.
    await live.restoreHistoricalSettings(() => ({ autoCompounds: { [M]: [{ name: 'ringofluck', targetTier: 3, quantity: -1 }] },
      autoItemMarks: { [M]: { 'spookyamulet@+0': 'bank' } } }));
    await live.post('/config', { itemCollectionThreshold: 1 });
    await expect.poll(async () => (await live.state()).characters[W]?.reservedInventory?.length, { timeout: 15_000 }).toBe(SLOTS.length);

    // The dashboard labels every held piece with its set instead of the automatic rule; the spare ring keeps its rule.
    await page.goto(live.url);
    const card = page.locator('article').filter({ has: page.getByRole('heading', { name: W, exact: true }) });
    const inventory = card.getByRole('button', { name: /^Inventory/ });
    if (await inventory.getAttribute('aria-expanded') !== 'true') await inventory.click();
    const rings = card.getByLabel('Ring of Luck', { exact: true });
    await expect(rings).toHaveCount(5);
    await expect.poll(async () => (await rings.allTextContents()).map(text => text.includes('Luck set') ? 'held' : text.includes('Auto compound') ? 'rule' : text).sort(),
      { timeout: 30_000 }).toEqual(['held', 'held', 'rule', 'rule', 'rule']);
    const amulet = card.getByLabel('Amulet of Spooks', { exact: true });
    await expect(amulet).toHaveCount(1);
    await expect(amulet).toContainText('Luck set');
    await expect(amulet).not.toContainText('Auto bank');
    await info.attach('gear-sets-dashboard', { body: await card.screenshot(), contentType: 'image/png' });
    // Only now may the merchant collect, so the dashboard shows every copy first.
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'party collection': true, 'auto compound': true } });

    // 4. Real combat: every luck piece must be worn at once before a kill, then the tank set returns.
    await live.post('/farming-mode', { character: W, mode: 'default' });
    await live.post('/focus', { character: W, monsterFocus: ['goo'] });
    await live.post('/travel', await location(live));
    const kills = async () => (await live.clients[W].events()).filter((event: any) => event.event === 'hit' && event.data?.hid === W && event.data?.kill);
    let sampling = true;
    const sampler = (async () => { while (sampling) { samples.push({ at: Date.now(), worn: await worn(live).catch(() => null) }); await new Promise(r => setTimeout(r, 100)); } })();
    await expect.poll(async () => samples.some(sample => sample.worn && SLOTS.every(slot => sample.worn[slot] === LUCK[slot])) && (await kills()).length > 0,
      { timeout: 180_000, intervals: [500], message: 'The tank must wear all six luck pieces at once and land a kill' }).toBe(true);
    // 12: while goos keep dying the luck set stays on, past the 10 s safety timeout.
    const first = samples.findIndex(sample => sample.worn && SLOTS.every(slot => sample.worn[slot] === LUCK[slot]));
    const killsAtFirst = (await kills()).length;
    await new Promise(resolve => setTimeout(resolve, 15_000));
    const chain = samples.slice(first).filter(sample => sample.worn);
    expect((await kills()).length - killsAtFirst, 'Kills must continue during the chain window').toBeGreaterThan(3);
    expect(chain.filter(sample => !SLOTS.every(slot => sample.worn[slot] === LUCK[slot])).length,
      'The luck set must stay on while kills keep coming').toBe(0);
    // 13: once kills stop, the tank set returns and stays. Declared world change: main's goos
    // are removed and their respawns held, so the party runs out of targets.
    const held = await live.admin(`output=(()=>{globalThis.__e2eGearGooRespawns=[];
      for(let i=monster_respawns.length-1;i>=0;i--)if(monster_respawns[i][0].type==='goo'&&monster_respawns[i][0].map==='main')
        globalThis.__e2eGearGooRespawns.push(monster_respawns.splice(i,1)[0]);
      let removed=0;for(const m of Object.values(instances.main.monsters))if(m.type==='goo'){remove_monster(m,{method:'disappear',nospawn:true});removed++;}
      return {removed,held:globalThis.__e2eGearGooRespawns.length};})()`);
    await info.attach('gear-sets-goos-removed', { body: JSON.stringify(held), contentType: 'application/json' });
    const tankBack = (sample: any) => sample.worn && SLOTS.every(slot => sample.worn[slot] === tankWorn[slot]);
    await expect.poll(() => { const recent = samples.slice(-3); return recent.length === 3 && recent.every(tankBack); },
      { timeout: 60_000, message: 'The tank set must be restored once kills stop, emptying slots that were empty' }).toBe(true);
    sampling = false; await sampler;

    // 5. The spare ring is collected for compounding; the two set rings stay with the tank.
    const counts: any[] = [];
    const count = async () => { const now = { at: Date.now(), rings: await heldCount(live, 'ringofluck'), earrings: await heldCount(live, 'mearring'),
      amulets: await heldCount(live, 'spookyamulet') }; counts.push(now); return now; };
    await expect.poll(async () => (await count()).rings, { timeout: 180_000, intervals: [2000],
      message: 'The merchant must collect only the three spare Rings of Luck' }).toBe(2);
    await new Promise(resolve => setTimeout(resolve, 20_000));
    const settled = await count();
    await info.attach('gear-sets-held-counts', { body: JSON.stringify(counts, null, 2), contentType: 'application/json' });
    expect(settled.rings, 'Set rings are never collected').toBe(2);
    expect(settled.earrings).toBe(2);
    expect(settled.amulets, 'The Auto bank rule never takes the luck amulet').toBe(1);
    expect((await live.state()).marked?.[W]?.filter((mark: any) => mark.item?.name === 'spookyamulet') || []).toEqual([]);
    await info.attach('gear-sets-evidence', { body: JSON.stringify({ given, tankWorn, saved, fullLuckSamples: samples.filter(s => s.worn && SLOTS.every(slot => s.worn[slot] === LUCK[slot])).length,
      kills: (await kills()).length, state: (await live.state()).characters[W]?.reservedInventory }, null, 2), contentType: 'application/json' });
  } finally {
    await info.attach('gear-sets-samples', { body: JSON.stringify(samples.slice(-400), null, 2), contentType: 'application/json' });
  }
});
