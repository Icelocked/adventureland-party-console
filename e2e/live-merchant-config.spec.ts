import { test, expect } from './live-fixtures';

test.use({ merchantDefault: null });

test('fresh merchant login automatically enables merchant controls and persists through restart', async ({ page, live }, info) => {
  test.setTimeout(180_000);
  const name = 'E2EMerchant';
  try {
    // No merchant/config request: the first real merchant heartbeat must assign it.
    await expect.poll(async () => (await live.state()).merchantCharacter).toBe(name);
    await page.goto(live.url);
    const card = page.locator('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
    await expect(card.getByText(/Merchant logistics/)).toBeVisible();
    await expect(card.getByRole('button', {name: 'Donate gold', exact: true})).toBeVisible();
    await expect(card.getByText(/Monster focus/)).toHaveCount(0);
    await card.getByRole('button', {name: 'Donate gold', exact: true}).click();
    const donation = page.getByRole('dialog', {name: 'Donate gold for merchant XP'});
    await expect(donation).toContainText(name + ' will withdraw');
    await donation.getByRole('button', {name: 'Cancel', exact: true}).click();
    const before = await live.state();
    await info.attach('merchant-controls-before-restart', {body: await page.screenshot({fullPage:true}),contentType:'image/png'});
    await live.restartCoordinator();
    await expect.poll(async () => (await live.state()).merchantCharacter).toBe(name);
    await page.reload();
    await expect(card.getByText(/Merchant logistics/)).toBeVisible();
    // Confirm that the assigned merchant can execute actual bank work, not only render controls.
    await live.post('/command', {character:name,type:'bank'});
    await expect.poll(async () => (await live.state()).bank?.character, {timeout:90_000}).toBe(name);
    const after = await live.state();
    await info.attach('merchant-autoconfiguration-and-bank', {body:JSON.stringify({before,after}),contentType:'application/json'});
    await info.attach('merchant-controls-after-restart', {body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  } finally {
    // Close the dashboard's live connections before the live fixture closes its gateway.
    await page.close();
  }
});
