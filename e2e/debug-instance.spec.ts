import { test, expect } from './fixtures';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

test('Settings launches a disposable god party, repeats Cave entry and destroys its stack', async ({ page, app, context }, info) => {
  test.setTimeout(1_800_000);
  page.setDefaultTimeout(30000);
  const settings = page.getByRole('dialog', { name: 'Interface settings' });
  const openSettings = async () => {
    await expect(async () => {
      if (!await settings.isVisible()) await page.getByRole('button', { name: 'Interface settings', exact: true }).click();
      await expect(settings).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 30000 });
  };
  await page.goto(app.url);
  await expect(page.getByRole('heading', { name: 'W', exact: true })).toBeVisible();
  await openSettings();
  const start = page.getByRole('button', { name: 'Start debug instance', exact: true });
  await start.scrollIntoViewIfNeeded();
  const stop = page.getByRole('button', { name: 'Stop running', exact: true });
  const state = async () => (await context.request.get(app.url + '/console-debug')).json();
  let project = '';
  try {
    await start.click();
    await expect(page.getByRole('status', { name: 'Debug instance status' })).toContainText(/Starting|Building|Checking/);
    const starting = await state();
    await context.request.post(app.url + '/console-debug/start', { headers: { Origin: app.url }, data: {} });
    expect((await state()).project).toBe(starting.project);
    await expect.poll(async () => {
      const current = await state();
      if (current.phase === 'error') throw Error(current.error);
      return current.phase;
    }, { timeout: 1_500_000, intervals: [2000] }).toBe('running');
    const running = await state(); project = running.project;
    const link = page.getByRole('link', { name: 'Open debug console' });
    const url = await link.getAttribute('href');
    expect(new URL(url!).port).not.toBe('3010');
    const debug = await context.newPage(); await debug.goto(url!);
    await expect(debug.getByRole('heading', { name: 'E2EWarrior', exact: true })).toBeVisible();
    const origin = new URL(url!).origin;
    const unauthorized = await fetch(origin + '/party-api/state');
    expect(unauthorized.status).toBe(401);
    const nested = await debug.request.post(origin + '/console-debug/start', { headers: { Origin: origin }, data: {} });
    expect(nested.status()).toBe(403);
    const native = await (await debug.request.get(origin + '/party-api/state')).json();
    for (const name of ['E2EWarrior', 'E2EPriest', 'E2EMerchant']) {
      expect(native.characters[name].slots.mainhand.item.level).toBe(100);
      expect(native.characters[name].dungeon.supported).toBe(true);
    }
    await info.attach('debug-god-party', { body: JSON.stringify(native.characters), contentType: 'application/json' });
    const dungeon = async () => (await debug.request.get(origin + '/party-api/daily-dungeons')).json();
    const post = async (action: string) => {
      const response = await debug.request.post(origin + '/party-api/daily-dungeons', {
        headers: { Origin: origin }, data: { action, operationId: 'debug-e2e-' + Date.now() },
      });
      expect(response.ok(), await response.text()).toBe(true);
    };
    const visits: unknown[] = [];
    for (let visit = 0; visit < 2; visit++) {
      await expect.poll(async () => (await dungeon()).members.every((m: any) => m.fresh && m.observation?.visit?.available),
        { timeout: 90_000 }).toBe(true);
      await post('enter');
      await expect.poll(async () => (await dungeon()).state.phase, { timeout: 120_000 }).toBe('active');
      visits.push(await dungeon());
      await post('exit');
      await expect.poll(async () => (await dungeon()).state.phase, { timeout: 120_000 }).toBe('held');
      await post('release');
    }
    await info.attach('debug-cave-visits', { body: JSON.stringify(visits, null, 2), contentType: 'application/json' });
    await info.attach('debug-console', { body: await debug.screenshot(), contentType: 'image/png' });
    await page.reload(); await openSettings();
    await expect(stop).toBeEnabled();
    await stop.scrollIntoViewIfNeeded();
    await info.attach('debug-settings-running', { body: await page.screenshot(), contentType: 'image/png' });
    await stop.click();
    await expect.poll(async () => (await state()).phase, { timeout: 120_000 }).toBe('stopped');
    for (const resource of ['container', 'volume', 'network']) {
      const { stdout } = await execute('docker', [resource, 'ls', ...(resource === 'container' ? ['-a'] : []), '-q', '--filter', `label=party-console.debug=${project}`]);
      expect(stdout.trim(), resource + ' must be destroyed').toBe('');
    }
    await info.attach('debug-destroyed', { body: JSON.stringify({ project, state: await state(), resources: [] }), contentType: 'application/json' });
    await start.click();
    await expect(stop).toBeEnabled();
    const cancelled = await state();
    expect(cancelled.project).not.toBe(project);
    await stop.click();
    await expect.poll(async () => (await state()).phase, { timeout: 120_000 }).toBe('stopped');
    for (const resource of ['container', 'volume', 'network']) {
      const { stdout } = await execute('docker', [resource, 'ls', ...(resource === 'container' ? ['-a'] : []), '-q', '--filter', `label=party-console.debug=${cancelled.project}`]);
      expect(stdout.trim(), 'Cancelled ' + resource).toBe('');
    }
    await info.attach('debug-cancelled', { body: JSON.stringify({ project: cancelled.project, state: await state() }), contentType: 'application/json' });
  } finally {
    await context.request.post(app.url + '/console-debug/stop', { headers: { Origin: app.url }, data: {} });
    await expect.poll(async () => (await state()).phase, { timeout: 120_000 }).toBe('stopped');
  }
});
