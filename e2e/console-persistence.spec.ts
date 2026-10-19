import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures';

// Failure inventory: docs/efficiency.md (Persistence). These journeys cover the
// items that need the real coordinator and dashboard; the rest are unit tests.

const historyKey = 'party_dashboard_history_state_v1';
function savedRecords(journal: string, key: string) {
  return readFileSync(journal, 'utf8').split('\n').filter(line => line.startsWith(`{"${key}":`)).length;
}
function summary(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (share: number) => sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)];
  return { count: sorted.length, median: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1], samples };
}
// Measurements also go to stdout, so a passing run reports them without its attachments.
async function report(info: import('@playwright/test').TestInfo, name: string, value: unknown) {
  console.log('persistence-metric', name, JSON.stringify(value));
  await info.attach(name, { contentType: 'application/json', body: JSON.stringify(value, null, 2) });
}
async function openDashboardLogs(page: import('@playwright/test').Page) {
  await page.goto('/');
  // A shared development server may finish initial module discovery and reload.
  await page.waitForTimeout(2000);
  const sidebar = page.getByRole('complementary', { name: 'Live logs' });
  // The first click can land before hydration on a cold development server.
  await expect(async () => {
    if (!await sidebar.isVisible()) await page.getByRole('button', { name: 'Show logs' }).click();
    await expect(sidebar).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });
  await sidebar.getByRole('tab', { name: 'Dashboard logs' }).click();
  return sidebar;
}

test('combat lines show at once, save once per window and survive a restart', async ({ page, app }, info) => {
  // P2 items 2, 3 and 5: lines missing from the save, lost at shutdown, or
  // shown only after the save.
  const sidebar = await openDashboardLogs(page);
  const before = savedRecords(app.journal, historyKey);
  const started = Date.now(), latency: number[] = [], messages: string[] = [];
  for (let index = 0; index < 20; index++) {
    const message = `Persistence probe ${index}`;
    messages.push(message);
    const sent = Date.now();
    const response = await page.request.post('/party-api/combat-log', {
      headers: { Origin: app.url }, data: { character: 'W', events: [{ type: 'info', message }] } });
    expect(response.ok()).toBe(true);
    await expect(sidebar.getByText(message, { exact: true })).toBeVisible();
    latency.push(Date.now() - sent);
  }
  const elapsed = Date.now() - started, appended = savedRecords(app.journal, historyKey) - before;
  await report(info, 'combat-line-dashboard-latency', { ...summary(latency), elapsed, historyRecordsAppended: appended });
  // One save per 5 s window, plus one for a window already open at the start.
  expect(appended).toBeLessThanOrEqual(Math.ceil(elapsed / 5000) + 1);
  await app.restartCoordinator();
  const saved = (await app.state()).combatLogs.W.map((entry: { message: string }) => entry.message)
    .filter((message: string) => message.startsWith('Persistence probe'));
  expect(saved).toEqual(messages);
});

test('status reports reach the dashboard without waiting for saves', async ({ page, app }, info) => {
  // Speed requirement: saves never sit between a status report and the DOM.
  // The fixture heartbeat replaces W every second, so each probe repeats
  // until the dashboard shows it; latency counts from the first send.
  await page.goto('/');
  await page.waitForTimeout(2000);
  const base = (await app.state()).characters.W;
  await expect(page.getByText('1,000 / 1,000').first()).toBeVisible();
  const latency: number[] = [], response: number[] = [];
  for (let index = 0; index < 20; index++) {
    const hp = 501 + index, target = `${hp} / 1,000`;
    await page.evaluate(text => {
      const probe = window as unknown as { probeSeenAt?: number };
      delete probe.probeSeenAt;
      const check = () => {
        if (document.body.textContent?.includes(text)) probe.probeSeenAt = Date.now();
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    }, target);
    const first = Date.now();
    for (;;) {
      const sent = performance.now();
      await app.deliverStatus({ ...base, name: 'W', hp });
      response.push(performance.now() - sent);
      const seen = await page.evaluate(() => (window as unknown as { probeSeenAt?: number }).probeSeenAt);
      if (seen) { latency.push(seen - first); break; }
      if (Date.now() - first > 10_000) throw Error('Dashboard never showed ' + target);
      await page.waitForTimeout(150);
    }
  }
  await report(info, 'status-dashboard-latency', { dom: summary(latency), statusResponseMs: summary(response.map(ms => Math.round(ms * 100) / 100)) });
});

// Journal records as [key, JSON text] pairs, in file order.
function journalRecords(journal: string): [string, string][] {
  return readFileSync(journal, 'utf8').split('\n').flatMap(line => {
    const key = /^\{"([^"]+)":/.exec(line)?.[1];
    return key ? [[key, line] as [string, string]] : [];
  });
}
const saved = (journal: string, key: string) => journalRecords(journal).filter(([name]) => name === key).map(([name, line]) => JSON.parse(line)[name]);
const settingsKey = 'party_dashboard_settings_state_v1';
const mailSettings = (page: import('@playwright/test').Page, url: string, settings: { autoCollect: boolean; autoDelete: boolean }) =>
  page.request.post(`${url}/party-api/mail/settings`, { headers: { Origin: url }, data: settings });

// The mail settings route needs the mailbox fixture's account boundary.
test.describe('saves through the mail settings route', () => {
  test.use({ mailbox: true });
  test('saves that repeat the last record append nothing, and a restart reads the same state', async ({ page, app }, info) => {
    // P1 items 1 and 4. Native status reports save the roster on every fixture
    // heartbeat, and each mail settings POST saves settings with unchanged content.
    await page.waitForTimeout(3000);
    for (let index = 0; index < 5; index++) expect((await mailSettings(page, app.url, { autoCollect: false, autoDelete: false })).ok()).toBe(true);
    await page.waitForTimeout(8000);
    const last = new Map<string, string>(), repeats: string[] = [], appended: Record<string, number> = {};
    for (const [key, line] of journalRecords(app.journal)) {
      if (last.get(key) === line) repeats.push(key);
      last.set(key, line);
      appended[key] = (appended[key] || 0) + 1;
    }
    await report(info, 'journal-records-by-key', { appended, repeats });
    expect(repeats).toEqual([]);
    const before = await app.state();
    await app.restartCoordinator();
    const after = await app.state();
    expect(Object.keys(after.characterSnapshots ?? {})).toEqual(Object.keys(before.characterSnapshots ?? {}));
    expect((await (await page.request.get(`${app.url}/party-api/mail`)).json()).settings).toEqual({ autoCollect: false, autoDelete: false });
  });

  test('settings save in layout 2 within a second of a change, and in the v1.4.0 layout at shutdown', async ({ page, app }, info) => {
    // P3 items 7 and 9 through the real coordinator; layout 2 keeps the market
    // cache and production under their own keys while the console runs.
    await page.waitForTimeout(2000);
    const changed = Date.now();
    expect((await mailSettings(page, app.url, { autoCollect: true, autoDelete: false })).ok()).toBe(true);
    await expect.poll(() => saved(app.journal, settingsKey).at(-1)?.mailbox?.settings?.autoCollect, { intervals: [100] }).toBe(true);
    const saveMs = Date.now() - changed;
    const running = saved(app.journal, settingsKey);
    expect(running.at(-1).persistenceLayout).toBe(2);
    expect(running.filter(record => 'production' in record || 'aldataMarketListings' in record)).toEqual([]);
    expect(saved(app.journal, 'party_dashboard_production_state_v1').length).toBeGreaterThan(0);
    expect(saved(app.journal, 'party_dashboard_market_state_v1').length).toBeGreaterThan(0);
    await app.restartCoordinator();
    const shutdown = saved(app.journal, settingsKey).filter(record => 'production' in record && 'aldataMarketListings' in record);
    await report(info, 'settings-layout', { saveMs, runningRecords: running.length, shutdownRecords: shutdown.length });
    // A material change saves within a second, plus the poll.
    expect(saveMs).toBeLessThan(2500);
    expect(shutdown.length).toBeGreaterThan(0);
    expect(shutdown.at(-1)).toMatchObject({ persistenceLayout: 2, mailbox: { settings: { autoCollect: true } } });
    expect((await (await page.request.get(`${app.url}/party-api/mail`)).json()).settings).toEqual({ autoCollect: true, autoDelete: false });
  });
});

test.describe('saved entries past their window', () => {
  const now = Date.now(), hour = 3_600_000;
  const rare = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`USII|main|1|rare-${index}`, { start: now - hour, progress: index, lowHp: 0 }]));
  test.use({ mailbox: true, savedRecords: [{ [settingsKey]: { mluckCastAt: { Expired: now - 2 * hour, Current: now - 60_000 }, rarePursuitProgress: rare } }] });
  test('load drops expired luck casts and keeps the newest 100 rare pursuits', async ({ page, app }, info) => {
    // P5 items 3, 4 and 6 through a saved journal and the real coordinator load.
    await page.waitForTimeout(2000);
    expect((await mailSettings(page, app.url, { autoCollect: true, autoDelete: false })).ok()).toBe(true);
    await expect.poll(() => saved(app.journal, settingsKey).at(-1)?.mailbox?.settings?.autoCollect, { intervals: [100] }).toBe(true);
    const record = saved(app.journal, settingsKey).at(-1);
    await report(info, 'retained-entries', { mluckCastAt: record.mluckCastAt, rare: Object.keys(record.rarePursuitProgress).length });
    expect(Object.keys(record.mluckCastAt)).toEqual(['Current']);
    expect(Object.keys(record.rarePursuitProgress)).toHaveLength(100);
    expect(record.rarePursuitProgress).not.toHaveProperty(['USII|main|1|rare-0']);
    expect(record.rarePursuitProgress).toHaveProperty(['USII|main|1|rare-100']);
  });
});
