import { test, expect } from './fixtures';

const pageErrors = new WeakMap<object, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.stack || error.message));
});
test.afterEach(async ({ page }, testInfo) => {
  const errors = pageErrors.get(page) || [];
  await testInfo.attach('browser-runtime-errors', { body: Buffer.from(JSON.stringify(errors, null, 2)), contentType: 'application/json' });
  expect(errors, 'The browser must not crash during the journey').toEqual([]);
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
