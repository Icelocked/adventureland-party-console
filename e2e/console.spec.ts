import { test, expect } from './fixtures';

const pageErrors = new WeakMap<object, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.on('console', message => {
    if (message.type() === 'error' && message.text().includes('Party Console render failed')) errors.push(message.text());
  });
});
test.afterEach(async ({ page }, testInfo) => {
  const errors = pageErrors.get(page) || [];
  await testInfo.attach('browser-runtime-errors', { body: Buffer.from(JSON.stringify(errors, null, 2)), contentType: 'application/json' });
  expect(errors, 'The browser must not crash during the journey').toEqual([]);
});

test('Live WTB counts bank stock after empty slots without withdrawing it', async ({ page }, info) => {
  // Failure modes: empty slot objects crash rendering; later stock is omitted;
  // multiple bank stacks are undercounted; merchant-only stock stops matching.
  // Inject the bank/market read boundary; the dashboard and its UI actions run normally.
  const bank = { gold: 0, packs: { items0: [null, {}, { slot: 2, item: { name: 'leather', q: 4 } }],
    items1: [{ slot: 0, item: { name: 'leather', q: 2 } }] } };
  const orders = [
    { key: 'bank-leather', buyer: 'E2EBankBuyer', item: { name: 'leather' }, quantity: 9 },
    { key: 'inventory-sword', buyer: 'E2EInventoryBuyer', item: { name: 'sword', level: 0 }, quantity: 5 },
  ].map(order => ({ ...order, source: 'aldata', slot: 'trade1', map: 'main', x: 0, y: 0,
    price: 1000, serverRegion: 'US', serverIdentifier: 'II', lastSeen: new Date().toISOString(), seenAt: Date.now() }));
  await page.route('**/party-api/state*', async route => {
    const response = await route.fetch();
    const state = await response.json();
    await route.fulfill({ response, json: { ...state, bank, aldata: { ...state.aldata, buyOrders: orders } } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'M', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View market', exact: true }).click();
  await page.getByRole('button', { name: /^Live WTB/ }).click();
  await expect(page.getByText(/2 offers match exact items currently held by M/)).toBeVisible();
  const bankRow = page.getByRole('button', { name: /E2EBankBuyer/ }).locator('..');
  await expect(bankRow).toContainText('You have 6');
  await expect(bankRow.getByRole('button', { name: 'Sell', exact: true })).toBeEnabled();
  await bankRow.getByRole('button', { name: 'All', exact: true }).click();
  await expect(bankRow.getByLabel('Quantity of leather to sell')).toHaveValue('6');
  const inventoryRow = page.getByRole('button', { name: /E2EInventoryBuyer/ }).locator('..');
  await expect(inventoryRow).toContainText('You have 1');
  await expect(inventoryRow.getByRole('button', { name: 'Sell', exact: true })).toBeEnabled();
  await info.attach('bank-wtb-inputs', { body: JSON.stringify({ bank, orders }), contentType: 'application/json' });
  await info.attach('bank-wtb-available-without-withdrawal', { body: await page.screenshot(), contentType: 'image/png' });
});

test('account preference rejects invalid drafts and survives reload and coordinator restart', async ({ page, app }, testInfo) => {
  const evidence: Record<string, unknown> = { before: await app.state(), exchanges: [] };
  const exchanges = evidence.exchanges as unknown[];
  await page.goto('/');
  const openSettings = async () => {
    // Live cards require the browser's coordinator subscription to be mounted.
    await expect(page.getByRole('heading', { name: 'W', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Interface settings', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Interface settings' })).toBeVisible();
  };
  await openSettings();
  const input = page.getByLabel('Default name for bankboi', { exact: true });
  const initial = await input.inputValue();
  const save = async (value: string, status: number) => {
    await input.fill(value);
    const received = page.waitForResponse(response =>
      new URL(response.url()).pathname.endsWith('/dashboard-preferences') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Save name', exact: true }).click();
    const response = await received;
    // The settings UI consumes only rejected bodies; success is verified against real state.
    const body = response.ok() ? undefined : await response.json();
    exchanges.push({ request: response.request().postDataJSON(), status: response.status(), response: body });
    expect(response.status()).toBe(status);
    return body;
  };
  const rejected = await save('x', 400);
  await expect(page.getByRole('alert').filter({ hasText: rejected.error })).toBeVisible();
  await expect(input).toHaveValue('x');
  expect((await app.state()).bankboiPrefix || '').toBe(initial);
  await save('E2EBank', 200);
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: rejected.error })).toHaveCount(0);
  expect((await app.state()).bankboiPrefix).toBe('E2EBank');
  await save('!', 400);
  await expect(input).toHaveValue('!');
  expect((await app.state()).bankboiPrefix).toBe('E2EBank');
  await page.reload();
  await openSettings();
  await expect(input).toHaveValue('E2EBank');
  evidence.afterReload = await app.state();
  await app.restartCoordinator();
  await page.reload();
  await openSettings();
  await expect(input).toHaveValue('E2EBank');
  evidence.afterRestart = await app.state();
  expect((evidence.afterRestart as { bankboiPrefix?: string }).bankboiPrefix).toBe('E2EBank');
  await input.scrollIntoViewIfNeeded();
  await testInfo.attach('persisted-account-setting', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await testInfo.attach('account-setting-http-and-state', { body: Buffer.from(JSON.stringify(evidence, null, 2)), contentType: 'application/json' });
});

test('inventory context menu and upgrade preview stay readable without queueing an upgrade', async ({ page, app }, testInfo) => {
  const previews: unknown[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.endsWith('/upgrade-preview') && request.method() === 'POST') previews.push(request.postDataJSON());
  });
  await page.goto('/');
  const merchant = page.locator('article').filter({ has: page.getByRole('heading', { name: 'M', exact: true }) });
  const sword = merchant.getByText('sword', { exact: true });
  await expect(sword).toBeVisible();
  const before = await app.state();
  await sword.click({ button: 'right' });
  const rootMenu = page.locator('[data-slot="context-menu-content"]');
  await expect(rootMenu).toBeVisible();
  await expect(rootMenu).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(rootMenu).toHaveCSS('color', 'rgb(0, 0, 0)');
  const equip = rootMenu.getByRole('menuitem', { name: 'Equip', exact: true });
  await expect(equip).toHaveCSS('color', 'rgb(0, 0, 0)');
  await equip.hover();
  await expect(equip).toHaveAttribute('data-highlighted', '');
  const hover = await equip.evaluate(element => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    const background = getComputedStyle(element).backgroundColor;
    context.fillStyle = background;
    context.fillRect(0, 0, 1, 1);
    return { background, rgba: [...context.getImageData(0, 0, 1, 1).data] };
  });
  expect(hover.rgba[3]).toBe(255);
  for (const channel of hover.rgba.slice(0, 3)) {
    expect(channel).toBeGreaterThanOrEqual(230);
    expect(channel).toBeLessThan(255);
  }
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/upgrade-preview') && response.request().method() === 'POST');
  await rootMenu.getByRole('menuitem', { name: 'Mark for upgrade', exact: true }).hover();
  const preview = page.getByRole('region', { name: 'Upgrade chances' });
  await expect(preview).toBeVisible();
  const submenu = page.locator('[data-slot="context-menu-sub-content"]').filter({ has: preview });
  await expect(submenu).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(submenu).toHaveCSS('color', 'rgb(0, 0, 0)');
  await expect(preview).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(preview).toHaveCSS('color', 'rgb(0, 0, 0)');
  await expect(preview.getByText('Next attempt: +0 → +1', { exact: true })).toBeVisible();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const previewResult = await response.json();
  expect(previewResult.status).not.toMatch(/queued|running/);
  await expect(preview.getByRole('status')).not.toContainText('Refreshing');
  expect(previews.length).toBeGreaterThan(0);
  for (const body of previews) expect(body).toMatchObject({ character: 'M', refresh: false });
  const after = await app.state();
  for (const field of ['upgrades', 'merchantQueue', 'merchantCurrent']) {
    expect(before, `The real state must expose ${field}`).toHaveProperty(field);
    expect(after[field], `Opening a preview must not change ${field}`).toEqual(before[field]);
  }
  await testInfo.attach('context-menu-upgrade-preview', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await testInfo.attach('preview-read-evidence', { body: Buffer.from(JSON.stringify({ hover, requests: previews, response: previewResult, before, after }, null, 2)), contentType: 'application/json' });
  await page.keyboard.press('Escape');
  await expect(preview).not.toBeVisible();
  await page.keyboard.press('Escape');
  await expect(rootMenu).not.toBeVisible();
});


test.describe('configured merchant dialog names', () => {
  test.use({merchantDialogs:true});
  test('market, bank and donation confirmations name the configured merchant without submitting work', async ({page,app}, info) => {
    const submitted: string[] = [];
    page.on('request', request => { if(request.method()==='POST') submitted.push(new URL(request.url()).pathname); });
    await page.goto('/');
    const card=page.locator('article').filter({has:page.getByRole('heading',{name:'M',exact:true})});
    await card.getByRole('button',{name:'Donate gold',exact:true}).click();
    const donation=page.getByRole('dialog',{name:'Donate gold for merchant XP'});
    await expect(donation).toContainText('M will withdraw any shortage');
    await donation.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.getByRole('button',{name:'View market',exact:true}).click();
    await page.getByRole('button',{name:/^Live WTB/}).click();
    await expect(page.getByText(/match exact items currently held by M or recorded/)).toBeVisible();
    await page.getByRole('button',{name:/^Ponty \(/}).click();
    await page.getByRole('button',{name:'Buy',exact:true}).click();
    const purchase=page.getByRole('dialog',{name:'Confirm Ponty purchase'});
    await expect(purchase).toContainText('M will travel as needed');
    await info.attach('configured-merchant-ponty',{body:await page.screenshot(),contentType:'image/png'});
    await purchase.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Inspect bank',exact:true}).click();
    const bank=page.getByRole('dialog',{name:'Bank',exact:true});
    await bank.getByRole('button',{name:/^Unlock items1/}).click();
    const vault=page.getByRole('dialog',{name:'Unlock bank vault?'});
    await expect(vault).toContainText('M will spend 10,000 gold');
    await vault.getByRole('button',{name:'Cancel',exact:true}).click();
    await bank.getByRole('button',{name:/^Unlock with The Bank Key/}).click();
    const floor=page.getByRole('dialog',{name:'Unlock bank floor?'});
    await expect(floor).toContainText('M will retrieve and consume The Bank Key');
    await info.attach('configured-merchant-bank',{body:await page.screenshot(),contentType:'image/png'});
    await floor.getByRole('button',{name:'Cancel',exact:true}).click();
    expect(submitted.filter(path=>/\/(donate|ponty-order|bank-unlock)$/.test(path))).toEqual([]);
    await info.attach('merchant-dialog-http-state',{body:JSON.stringify({submitted,state:await app.state()}),contentType:'application/json'});
  });
});

test.describe('unassigned merchant dialog names', () => {
  test.use({merchantConnected:false});
  test('market uses a generic merchant label before any merchant connects', async ({page,app}, info) => {
    expect((await app.state()).merchantCharacter).toBeNull();
    await page.goto('/');
    await expect(page.getByRole('heading', {name:'W',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'View market',exact:true}).click();
    await page.getByRole('button',{name:/^Live WTB/}).click();
    await expect(page.getByText(/match exact items currently held by the merchant or recorded/)).toBeVisible();
    await info.attach('unassigned-merchant-market',{body:await page.screenshot(),contentType:'image/png'});
  });
});
