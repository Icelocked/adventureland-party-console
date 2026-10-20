import {waitForGameplay} from './network-clock';
import { test, expect, type LiveGame } from './live-fixtures';
import { W, P } from './game/hunt-events';

// Failure inventory: e2e/gear-sets-failures.md (22-24). Declared inputs: the luck pieces
// and a shield in the designated tank's bag. Saving, the Equip buttons and every equip
// are native, through the dashboard.
const LUCK: Record<string, string> = { ring1: 'ringofluck', ring2: 'ringofluck', earring1: 'mearring', earring2: 'mearring', orb: 'rabbitsfoot', amulet: 'spookyamulet', offhand: 'shield' };
const SLOTS = Object.keys(LUCK);
const worn = (live: LiveGame) => live.clients[W].run(`(${JSON.stringify(SLOTS)}).reduce((out,slot)=>{out[slot]=character.slots[slot]?character.slots[slot].name:null;return out},{})`);
async function equipBy(live: LiveGame, wanted: Record<string, string | null>) {
  for (const [slot, name] of Object.entries(wanted)) {
    if (!name) continue;
    await live.clients[W].run(`(()=>{const i=character.items.findIndex(item=>item&&item.name===${JSON.stringify(name)});if(i<0)throw Error('missing ${name}');equip(i,${JSON.stringify(slot)});return true})()`);
    await expect.poll(async () => (await worn(live))[slot], { timeout: 10_000 }).toBe(name);
  }
}

test('each gear set has an Equip button that wears the whole set and holds it for editing', async ({ live, page }, info) => {
  test.setTimeout(240_000);
  await live.post('/formation', { leader: W, tank: W });
  await live.post('/formation', { character: P, follow: true });
  await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)});
    for(const name of ['ringofluck','ringofluck','mearring','mearring','rabbitsfoot','spookyamulet','shield']){const i=p.items.findIndex(x=>!x);if(i<0)throw Error('bag full');p.items[i]={name,level:0};}
    cache_player_items(p);resend(p,'u+cid+reopen');return true})()`);
  await expect.poll(async () => live.clients[W].run(`character.items.filter(i=>i&&i.name==='ringofluck').length`), { timeout: 30_000 }).toBe(2);
  const tankWorn = await worn(live);
  await expect.poll(async () => (await live.post('/gear-sets', { character: W, set: 'tank', action: 'save' }).catch(() => ({}))).ok, { timeout: 30_000 }).toBe(true);
  await equipBy(live, LUCK);
  await expect.poll(async () => { const slots = (await live.state()).characters[W]?.slots || {};
    return SLOTS.every(slot => slots[slot]?.item?.name === LUCK[slot]); }, { timeout: 15_000 }).toBe(true);
  expect((await live.post('/gear-sets', { character: W, set: 'luck', action: 'save' })).ok).toBe(true);

  await page.goto(live.url);
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: W, exact: true }) });
  const openSets = async () => {
    await expect(async () => {
      if (!await page.getByRole('region', { name: 'Tank gear set' }).isVisible()) await card.getByText(/^Gear sets \(/).click();
      await expect(page.getByRole('region', { name: 'Tank gear set' })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 60_000 });
  };
  // 22: Equip Tank wears the tank set, emptying the slots it left empty (earrings, orb, shield).
  await openSets();
  await page.getByRole('region', { name: 'Tank gear set' }).getByRole('button', { name: 'Equip Tank', exact: true }).click();
  await expect.poll(async () => { const now = await worn(live); return SLOTS.every(slot => now[slot] === tankWorn[slot]); }, { timeout: 30_000 }).toBe(true);
  // 22, 23: Equip Luck wears the whole luck set on the designated tank, and it stays on.
  await openSets();
  await page.getByRole('region', { name: 'Luck gear set' }).getByRole('button', { name: 'Equip Luck', exact: true }).click();
  await expect.poll(async () => { const now = await worn(live); return SLOTS.every(slot => now[slot] === LUCK[slot]); }, { timeout: 30_000 }).toBe(true);
  await waitForGameplay(8000);
  expect(await worn(live), 'The tank correction must not undo a manual set equip').toEqual(LUCK);
  await openSets();
  await expect(page.getByRole('region', { name: 'Luck gear set' })).toContainText(`(${Object.keys((await live.state()).gearSets[W].luck.slots).length} worn`);
  await info.attach('gear-set-equip', { body: await page.screenshot(), contentType: 'image/png' });
});
