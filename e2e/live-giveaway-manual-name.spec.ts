import { test, expect } from './live-fixtures';

// Failure inventory: e2e/giveaway-manual-name-failures.md. Dashboard actions only; the
// queued giveaway job is the coordinator's native response.
const merchant = 'E2EMerchant', host = 'GiveawayHost';

test('the giveaway dialog joins a host typed by name when they are not in the loaded list', async ({ live, page }, info) => {
  test.setTimeout(180_000);
  await expect.poll(async () => (await live.state()).giveawayRealms?.length || 0, { timeout: 60_000 }).toBeGreaterThan(0);
  const state = await live.state();
  const realm = state.giveawayRealms[0];
  const loaded: string[] = state.giveawayPlayers?.[realm.key] || [];
  expect(loaded, 'The typed host must not already be loaded').not.toContain(host);
  await page.goto(live.url);
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: merchant, exact: true }) });
  await card.getByRole('button', { name: 'Join giveaway', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Join giveaway' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox').first().click();
  await page.getByRole('option', { name: realm.label, exact: true }).click();
  // 3: a loaded player is still offered.
  if (loaded.length) {
    await dialog.getByRole('button', { name: 'Search online players' }).click();
    await expect(page.getByRole('option', { name: loaded[0], exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
  }
  // 1, 2: an unlisted host can be typed and joined.
  await dialog.getByRole('button', { name: 'Search online players' }).click();
  await page.getByPlaceholder('Search player name…').fill(`  ${host} `);
  await page.getByRole('option', { name: `Use “${host}”` }).click();
  await expect(dialog.getByRole('button', { name: host })).toBeVisible();
  const [request] = await Promise.all([
    page.waitForRequest(r => r.method() === 'POST' && new URL(r.url()).pathname === '/party-api/merchant/join-giveaway'),
    dialog.getByRole('button', { name: 'Join', exact: true }).click(),
  ]);
  expect(request.postDataJSON()).toEqual({ realm: realm.key, seller: host });
  await expect.poll(async () => (await live.state()).merchantActivity?.some((entry: any) =>
    entry.message === `Queued giveaway search for ${host} on ${realm.key.replace(/^SR_/, '')}`), { timeout: 20_000 }).toBe(true);
  await info.attach('giveaway-manual-name', { body: JSON.stringify({ realm, loaded, body: request.postDataJSON() }), contentType: 'application/json' });
});
