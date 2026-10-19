import { test, expect, type LiveGame } from './live-fixtures';
import type { Page } from '@playwright/test';

// Failure inventory: e2e/elixir-restock-failures.md. The fighter's restock policy names Liquid
// Luck (min 0, max 1); the merchant buys it from the Winter Inn bartender, delivers it, and the
// fighter drinks it. Declared input: the fixture disables every merchant automation; this
// journey enables restock only. Purchases, travel, delivery and the elixir are native.
const W = 'E2EWarrior', merchant = 'E2EMerchant';
const elixirs = (live: LiveGame) => live.admin(`output=(()=>{const p=get_player('${W}');
  return {active:p.slots.elixir?p.slots.elixir.name:null,expires:p.slots.elixir?.expires??null,
    carried:p.items.filter(i=>i&&i.name==='elixirluck').reduce((n,i)=>n+(i.q||1),0)};})()`);

test('the merchant buys and delivers a fighter\'s Liquid Luck, the fighter drinks it, and a spare follows', async ({ live }, info) => {
  test.setTimeout(600_000);
  const samples: any[] = [];
  try {
    expect(await elixirs(live)).toEqual({ active: null, expires: null, carried: 0 });
    // 1: the policy saves an elixir supply.
    const saved = await live.post('/restock', { character: W, hp: { min: 5, max: 20 }, mp: { min: 0, max: 0 }, elixir: { item: 'elixirluck', min: 0, max: 1 } });
    expect(saved.policy?.elixir).toEqual({ item: 'elixirluck', min: 0, max: 1 });
    const automations = (await live.state()).merchantAutomations || {};
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { ...Object.fromEntries(Object.keys(automations).map(name => [name, false])), restock: true } });
    // 2, 3, 4: the merchant buys one at the Winter Inn and delivers it; the fighter drinks it.
    const coordinator = async () => { const state = await live.state(); return { policy: state.restockPolicies?.[W] ?? null,
      queue: (state.merchantQueue || []).map((job: any) => [job?.reason, job?.target]), current: state.merchantCurrent && [state.merchantCurrent.reason, state.merchantCurrent.target],
      automations: state.merchantAutomations ?? null }; };
    await expect.poll(async () => { const now = await elixirs(live); samples.push({ at: Date.now(), phase: 'first', now, coordinator: await coordinator() }); return now.active; },
      { timeout: 300_000, intervals: [2000], message: 'The fighter must be drinking a delivered Liquid Luck' }).toBe('elixirluck');
    // 6: with the carried spare drunk, the merchant brings another, which stays in the bag (5).
    await expect.poll(async () => { const now = await elixirs(live); samples.push({ at: Date.now(), phase: 'spare', now }); return now; },
      { timeout: 300_000, intervals: [2000], message: 'The merchant must deliver a spare while one is active' }).toMatchObject({ active: 'elixirluck', carried: 1 });
    const settled = await elixirs(live);
    await new Promise(resolve => setTimeout(resolve, 10_000));
    expect(await elixirs(live), 'The spare must not be drunk while one is active').toEqual(settled);
    expect((await live.state()).merchantActivity.some((entry: any) => /insufficient gold/i.test(entry.message))).toBe(false);
  } finally {
    await info.attach('elixir-restock', { body: JSON.stringify({ samples, merchant: (await live.state().catch(() => ({})) as any).merchantActivity?.slice(-30) }), contentType: 'application/json' });
  }
});

// Failure 9: the character card's restock form saves the elixir supply.
async function restockSection(page: Page) {
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: W, exact: true }) });
  const min = card.getByLabel('Luck elixir min', { exact: true }), toggle = card.getByRole('button', { name: /^Merchant restock/ });
  // The section remembers it was open; read the toggle rather than racing hydration.
  await expect(toggle).toHaveAttribute('aria-expanded', /true|false/);
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await expect(min).toBeVisible();
  return card;
}
test('the dashboard restock form saves the Liquid Luck min and max', async ({ live, page }, info) => {
  test.setTimeout(300_000);
  await page.goto(live.url);
  const card = await restockSection(page);
  await card.getByLabel('Luck elixir min', { exact: true }).fill('1');
  await card.getByLabel('Luck elixir max', { exact: true }).fill('2');
  await card.getByRole('button', { name: 'Save restock' }).click();
  await expect.poll(async () => (await live.state()).restockPolicies?.[W]?.elixir ?? null, { timeout: 30_000,
    message: 'The coordinator must store the elixir supply saved from the form' }).toEqual({ item: 'elixirluck', min: 1, max: 2 });
  await expect.poll(async () => (await live.state()).restockPolicies?.[W]?.hp ?? null).toEqual({ item: 'hpot1', min: 5, max: 20 });
  // The saved values survive a reload of the dashboard.
  await page.reload();
  const reloaded = await restockSection(page);
  await expect(reloaded.getByLabel('Luck elixir min', { exact: true })).toHaveValue('1');
  await expect(reloaded.getByLabel('Luck elixir max', { exact: true })).toHaveValue('2');
  await info.attach('elixir-restock-form', { body: await page.screenshot(), contentType: 'image/png' });
});
