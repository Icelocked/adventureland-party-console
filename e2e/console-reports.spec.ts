import { test, expect } from './fixtures';

// Status report payloads through the real coordinator and dashboard
// (docs/efficiency.md, Report payload and Inventory deltas). The merchant
// fixture stays disconnected, so only these tests report M and no heartbeat
// replaces its inventory between steps.

test.use({ merchantConnected: false });

const inventory = async (url: string) => (await (await fetch(`${url}/party-api/state?section=inventory&dashboard=1`)).json()).characters?.M;
const coat = (level: number) => Array.from({ length: 42 }, (_, slot) => slot === 0 ? { slot, item: { name: 'coat', level }, meta: { properties: {} } } : null);

async function merchantReport(app: { state(): Promise<any> }) {
  const base = { ...(await app.state()).characters.W };
  for (const field of ['seenAt', 'inventorySeenAt', 'items', 'slots', 'bank']) delete base[field];
  return (extra: Record<string, unknown>) => ({ ...base, name: 'M', ctype: 'merchant', steamPrimary: false,
    runtimeId: 'e2e-report-M', clientInstance: 'e2e-report-M', ...extra });
}

test('a saved snapshot with per-copy item meta shows catalog names offline', async ({ page, app }, info) => {
  const report = await merchantReport(app);
  await app.deliverStatus(report({ items: coat(3), slots: {} }));
  // The roster keeps the per-copy meta; the dashboard joins the catalog's.
  expect((await app.state()).characterSnapshots.M.items[0]).toEqual({ slot: 0, item: { name: 'coat', level: 3 }, meta: { properties: {} } });
  await app.restartCoordinator();
  expect((await app.state()).characters.M).toBeUndefined();
  await page.goto('/');
  await page.getByRole('button', { name: 'Interface settings', exact: true }).click();
  await page.getByRole('button', { name: 'Inspect M', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Inspect Coat +3', exact: true })).toBeVisible();
  await info.attach('saved-snapshot-entry', { body: JSON.stringify((await app.state()).characterSnapshots.M.items[0]), contentType: 'application/json' });
});
