import { createServer, type Server } from 'node:http';
import type { Page } from '@playwright/test';
import { test, expect, type LiveGame } from './live-fixtures';

// Failure inventory: e2e/alninja-stand-price-failures.md. A local stand-in answers ALNinja's public
// GET /api/v1/prices/:item. Declared inputs: the stand-in's prices and the merchant's items
// (an administrative write to the native bag). The dashboard, coordinator and pop-up are native.
const M = 'E2EMerchant';
// A price button's name is its label followed by the amount, e.g. "ALNinja best bid +1 601 gold".
const button = (label: string) => new RegExp('^' + label.replace(/[+]/g, '\\+') + ' \\d');

async function standIn() {
  const requests: { url: string; auth?: string }[] = [];
  const server: Server = createServer((request, response) => {
    requests.push({ url: request.url || '', auth: request.headers.authorization });
    const match = /^\/api\/v1\/prices\/(\w+)\?region=(\w+)$/.exec(request.url || '');
    const rows = match?.[1] === 'hpot0' ? [
      { item: 'hpot0', level: 0, variant: 'shiny', price: 999, lowest: 990, median: 995, bestBid: 900, sellers: 1, buyers: 1, soldPerDay: 0, stale: false },
      { item: 'hpot0', level: 0, variant: '', price: 77, lowest: 70, median: 80, bestBid: 60, sellers: 3, buyers: 2, soldPerDay: 12, stale: false },
      { item: 'hpot0', level: 1, variant: '', price: 5000, lowest: 4000, median: 4500, bestBid: 3000, sellers: 1, buyers: 1, soldPerDay: 1, stale: false },
    ] : match?.[1] === 'helmet' ? [
      { item: 'helmet', level: 0, variant: '', price: 900, lowest: 850, median: 950, bestBid: 600, sellers: 3, buyers: 2, soldPerDay: 12, stale: false },
      { item: 'helmet', level: 1, variant: '', price: 4000, lowest: 3500, median: 4200, bestBid: 3000, sellers: 1, buyers: 1, soldPerDay: 1, stale: false },
    ] : [];
    response.writeHead(match ? 200 : 404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(match ? { region: match[2], item: match[1], prices: rows } : { error: 'not found' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, requests,
    close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

// The coordinator reads PARTY_ALNINJA_URL when its process starts, so the stand-in starts first.
let alninja: Awaited<ReturnType<typeof standIn>>;
test.beforeAll(async () => { alninja = await standIn(); process.env.PARTY_ALNINJA_URL = alninja.url; });
test.afterAll(async () => { delete process.env.PARTY_ALNINJA_URL; await alninja?.close(); });

async function seed(live: LiveGame, name: string) {
  await expect.poll(() => live.admin(`output=!!get_player('${M}')`), { timeout: 60_000, message: 'The merchant must be online' }).toBe(true);
  await live.admin(`output=(()=>{const m=get_player('${M}');const i=m.items.findIndex(x=>!x);
    m.items[i]={name:'${name}',level:0};cache_player_items(m);resend(m,'u+cid+reopen');return i})()`);
}
// The merchant card's inventory lists items by their game names.
async function inventoryItem(page: Page, label: string) {
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: M, exact: true }) });
  const inventory = card.getByRole('button', { name: /^Inventory/ });
  await expect(inventory).toBeVisible({ timeout: 60_000 });
  if (await inventory.getAttribute('aria-expanded') !== 'true') await inventory.click();
  const item = card.getByLabel(label, { exact: true }).first();
  await expect(item).toBeVisible({ timeout: 60_000 });
  return item;
}

test('the mark for stand pop-up offers ALNinja prices for the item\'s level in the merchant\'s region', async ({ live, page }, info) => {
  test.setTimeout(240_000);
  try {
    // 4: reporting stays off and no token is set.
    await live.post('/alninja', { enabled: false, token: '' });
    await seed(live, 'helmet');
    await page.goto(live.url);
    await (await inventoryItem(page, 'Helmet')).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Mark for stand', exact: true }).click();
    const dialog = page.getByRole('dialog');
    // 3: the merchant's realm is in the US region.
    await expect(dialog.getByText(/ALNinja \(US\): 3 selling · 12\.0 sold\/day/)).toBeVisible({ timeout: 30_000 });
    // 1, 2: the options use the level 0, no-variant row.
    const price = dialog.getByPlaceholder('Price');
    for (const [label, expected] of [['ALNinja price', '900'], ['ALNinja median', '950'], ['ALNinja lowest −1', '849']] as const) {
      await dialog.getByRole('button', { name: button(label) }).click();
      await expect(price).toHaveValue(expected);
    }
    expect(alninja.requests.map(r => r.url)).toContain('/api/v1/prices/helmet?region=US');
    expect(alninja.requests.every(r => !r.auth), 'Price lookups must not send a token').toBe(true);
    await info.attach('alninja-stand-price', { body: await page.screenshot(), contentType: 'image/png' });
    // 5: an item with no ALNinja listing disables the options and says why.
    await page.keyboard.press('Escape');
    await seed(live, 'shoes');
    await (await inventoryItem(page, 'Shoes')).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Mark for stand', exact: true }).click();
    await expect(dialog.getByText('ALNinja (US): no US listings')).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByRole('button', { name: /^ALNinja price/ })).toBeDisabled();
  } finally {
    await info.attach('alninja-price-requests', { body: JSON.stringify(alninja.requests), contentType: 'application/json' });
  }
});

test('the WTB order dialog offers ALNinja\'s best bid and cheapest seller for the selected level', async ({ live, page }, info) => {
  test.setTimeout(240_000);
  await seed(live, 'helmet');
  await page.goto(live.url);
  await (await inventoryItem(page, 'Helmet')).click();
  await page.getByRole('button', { name: 'Add to WTB', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /Add to WTB/ });
  // 6: the buy order uses the level 0, no-variant row's bid and sellers.
  await expect(dialog.getByText(/ALNinja \(US\): 2 buying · 3 selling · 12\.0 sold\/day/)).toBeVisible({ timeout: 30_000 });
  const price = dialog.getByLabel('Maximum price');
  for (const [label, expected] of [['ALNinja best bid +1', '601'], ['ALNinja best bid', '600'], ['ALNinja lowest seller', '850']] as const) {
    await dialog.getByRole('button', { name: button(label) }).click();
    await expect(price).toHaveValue(expected);
  }
  // 7: choosing +1 switches to that level's row.
  await dialog.getByLabel('Selected +level').fill('1');
  await expect(dialog.getByText(/ALNinja \(US \+1\): 1 buying · 1 selling/)).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('button', { name: button('ALNinja best bid +1') }).click();
  await expect(price).toHaveValue('3001');
  await info.attach('alninja-wtb-price', { body: await page.screenshot(), contentType: 'image/png' });
});
