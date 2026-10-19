import { test, expect, type LiveGame } from './live-fixtures';
import type { Page } from '@playwright/test';

// Failure inventory: e2e/elixir-choice-failures.md. Elixir supplies and the elixir each gear set
// keeps active are configured in the dashboard; the fighter drinks its worn set's elixir only once
// the active one expires; a supply nobody sells comes from the bank. Declared inputs: elixirs
// written to the fighter's bag and the merchant's bank, and the active elixir's expiry moved to
// the past (a 12-48 h wait). Equipping, drinking, the merchant's walk, withdrawal and delivery are native.
const W = 'E2EWarrior';
const worn = (live: LiveGame) => live.admin(`output=(()=>{const p=get_player('${W}');const e=p.slots.elixir;
  return {active:e?e.name:null,carried:Object.fromEntries(['elixirluck','elixirdex1'].map(n=>[n,p.items.filter(i=>i&&i.name===n).reduce((s,i)=>s+(i.q||1),0)]))};})()`);
async function restockSection(page: Page) {
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: W, exact: true }) });
  const toggle = card.getByRole('button', { name: /^Merchant restock/ });
  await expect(toggle).toHaveAttribute('aria-expanded', /true|false/);
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await expect(card.getByRole('button', { name: 'Save restock' })).toBeVisible();
  return card;
}
async function setElixir(page: Page, set: string, label: string) {
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: W, exact: true }) });
  await card.getByRole('button', { name: /^Gear sets/ }).click();
  const section = page.getByRole('region', { name: `${set} gear set` });
  await section.getByLabel(`${set} elixir`, { exact: true }).selectOption({ label });
  await page.keyboard.press('Escape');
}

test('the dashboard configures elixirs per character and gear set; the worn set\'s elixir waits for the active one to expire', async ({ live, page }, info) => {
  test.setTimeout(300_000);
  const automations = (await live.state()).merchantAutomations || {};
  await live.post('/merchant/routine-priorities', { priorities: {}, enabled: Object.fromEntries(Object.keys(automations).map(name => [name, false])) });
  await live.admin(`output=(()=>{const p=get_player('${W}');for(const [name,q] of [['elixirdex1',2],['elixirluck',1]]){
    const i=p.items.findIndex(x=>!x);if(i<0)throw Error('bag full');p.items[i]={name,q};}cache_player_items(p);resend(p,'u+cid+reopen');return true})()`);
  expect(await worn(live)).toEqual({ active: null, carried: { elixirluck: 1, elixirdex1: 2 } });
  await expect.poll(async () => (await live.post('/gear-sets', { character: W, set: 'tank', action: 'save' }).catch(() => ({}))).ok, { timeout: 30_000 }).toBe(true);
  await page.goto(live.url);

  // 2: the tank set (worn) keeps dexterity, chosen before any character default exists.
  await setElixir(page, 'Tank', 'Elixir of Greater Dexterity');
  await expect.poll(async () => (await live.state()).gearSets?.[W]?.tank?.elixir ?? null, { timeout: 30_000 }).toBe('elixirdex1');

  // 1: two supplies and the character default, saved from the form.
  const card = await restockSection(page);
  await card.getByRole('button', { name: 'Add elixir' }).click();
  await card.getByLabel('Elixir 1', { exact: true }).selectOption({ label: 'Liquid Luck' });
  await card.getByLabel('Elixir 1 max', { exact: true }).fill('1');
  await card.getByRole('button', { name: 'Add elixir' }).click();
  await card.getByLabel('Elixir 2', { exact: true }).selectOption({ label: 'Elixir of Greater Dexterity' });
  await card.getByLabel('Elixir 2 max', { exact: true }).fill('2');
  await card.getByLabel('Elixir kept active', { exact: true }).selectOption({ label: 'Liquid Luck' });
  await card.getByRole('button', { name: 'Save restock' }).click();
  await expect.poll(async () => { const p = (await live.state()).restockPolicies?.[W]; return p && { elixirs: p.elixirs, keepElixir: p.keepElixir }; },
    { timeout: 30_000, message: 'The coordinator must store both supplies and the default' })
    .toEqual({ elixirs: [{ item: 'elixirluck', min: 0, max: 1 }, { item: 'elixirdex1', min: 0, max: 2 }], keepElixir: 'elixirluck' });

  // 2: the worn set's elixir, not the character default (luck), is drunk.
  await expect.poll(async () => (await worn(live)).active, { timeout: 60_000, message: 'The worn tank set\'s elixir must be drunk' }).toBe('elixirdex1');
  expect((await worn(live)).carried.elixirluck, 'The character default is not drunk while the worn set names another').toBe(1);

  // 3: switching the set's elixir never replaces the active one.
  await setElixir(page, 'Tank', 'Liquid Luck');
  await expect.poll(async () => (await live.state()).gearSets?.[W]?.tank?.elixir ?? null, { timeout: 30_000 }).toBe('elixirluck');
  await new Promise(resolve => setTimeout(resolve, 8_000));
  expect(await worn(live), 'An active elixir must not be replaced').toEqual({ active: 'elixirdex1', carried: { elixirluck: 1, elixirdex1: 1 } });
  // Declared boundary: the active elixir's 24 hours pass.
  await live.admin(`output=(()=>{const p=get_player('${W}');p.slots.elixir.expires=new Date(Date.now()-1000);resend(p,'u+cid+reopen');return true})()`);
  await expect.poll(async () => (await worn(live)).active, { timeout: 60_000, message: 'The set\'s elixir must be drunk once the active one expires' }).toBe('elixirluck');

  // 2: re-saving the set keeps its elixir choice.
  expect((await live.post('/gear-sets', { character: W, set: 'tank', action: 'save' })).ok).toBe(true);
  expect((await live.state()).gearSets?.[W]?.tank?.elixir).toBe('elixirluck');
  await info.attach('elixir-choice', { body: await page.screenshot(), contentType: 'image/png' });
});

test('a saved single elixir supply keeps working, and a supply nobody sells comes from the bank', async ({ live }, info) => {
  test.setTimeout(600_000);
  // The server is shared: nothing active or carried, and no set naming an elixir.
  await live.admin(`output=(()=>{const p=get_player('${W}');p.slots.elixir=null;
    p.items=p.items.map(i=>i&&['elixirluck','elixirdex1'].includes(i.name)?null:i);cache_player_items(p);resend(p,'u+cid+reopen');return true})()`);
  await live.post('/gear-sets', { character: W, set: 'tank', action: 'elixir', elixir: 'default' }).catch(() => undefined);
  expect(await worn(live)).toEqual({ active: null, carried: { elixirluck: 0, elixirdex1: 0 } });
  // 5: a policy in the old shape becomes one supply and the default.
  const legacy = await live.post('/restock', { character: W, hp: { min: 5, max: 20 }, mp: { min: 0, max: 0 }, elixir: { item: 'elixirdex1', min: 0, max: 1 } });
  expect({ elixirs: legacy.policy?.elixirs, keepElixir: legacy.policy?.keepElixir }).toEqual({ elixirs: [{ item: 'elixirdex1', min: 0, max: 1 }], keepElixir: 'elixirdex1' });
  // 4: keep one Greater Dexterity carried but nothing kept active, so the delivered one stays in the bag.
  const saved = await live.post('/restock', { character: W, hp: { min: 5, max: 20 }, mp: { min: 0, max: 0 }, elixirs: [{ item: 'elixirdex1', min: 0, max: 1 }], keepElixir: null });
  expect(saved.policy?.keepElixir).toBeNull();
  const merchant = (await live.state()).merchantCharacter;
  await live.admin(`output=(async()=>{const p=get_player('${merchant}');const bank=await db.collection('user').findOne({_id:p.owner});
    const i=bank.info.items0.findIndex(x=>!x);bank.info.items0[i<0?0:i]={name:'elixirdex1',q:3};
    await db.collection('user').updateOne({_id:p.owner},{$set:{'info.items0':bank.info.items0}});if(p.user)p.user.items0=bank.info.items0;return true})()`);
  await live.post('/command', { character: merchant, type: 'bank' });
  await expect.poll(async () => Object.values((await live.state()).bank?.packs || {}).flat().some((entry: any) => entry?.item?.name === 'elixirdex1'),
    { timeout: 90_000, message: 'The coordinator\'s bank snapshot must list the banked elixir' }).toBe(true);
  const automations = (await live.state()).merchantAutomations || {};
  await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { ...Object.fromEntries(Object.keys(automations).map(name => [name, false])), restock: true } });
  try {
    await expect.poll(async () => (await worn(live)).carried.elixirdex1, { timeout: 420_000, intervals: [3000],
      message: 'The merchant must withdraw the unsold elixir from the bank and deliver it' }).toBeGreaterThanOrEqual(1);
  } finally {
    const state = await live.state().catch(() => ({})) as any;
    await info.attach('elixir-bank-restock', { body: JSON.stringify({ activity: state.merchantActivity?.slice(-30), queue: state.merchantQueue,
      current: state.merchantCurrent, policy: state.restockPolicies?.[W] }, null, 2), contentType: 'application/json' });
  }
  expect((await worn(live)).active, 'Nothing is kept active, so the delivered elixir stays in the bag').toBeNull();
  const activity = (await live.state()).merchantActivity || [];
  expect(activity.some((entry: any) => /no seller or bank stock/i.test(entry.message))).toBe(false);
});
