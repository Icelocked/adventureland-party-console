import { test, expect } from './fixtures';

// Request efficiency (docs/efficiency.md § Requests and logs) against the real
// coordinator behind the hosting gateway.

test('readiness route answers without building the state payload', async ({ app }, info) => {
  const started = performance.now();
  const response = await fetch(`${app.url}/party-api/ready`);
  const body = await response.text();
  const elapsed = performance.now() - started;
  await info.attach('ready-response', { body: JSON.stringify({ status: response.status, body, bytes: body.length, ms: elapsed }), contentType: 'application/json' });
  expect(response.status).toBe(200);
  expect(JSON.parse(body)).toEqual({ ready: true });
});

test('unknown state sections answer 400 and the dashboard requests only known sections', async ({ page, app }, info) => {
  const known = ['fast', 'inventory', 'logs', 'bank', 'market', 'catalog', 'config', 'core'];
  const unknown = await fetch(`${app.url}/party-api/state?section=mail`);
  const body = await unknown.json();
  expect(unknown.status).toBe(400);
  expect(body.characters).toBeUndefined();
  expect(body.sections).toEqual(expect.arrayContaining(known));
  const full = await fetch(`${app.url}/party-api/state?catalog=0`);
  expect(full.status).toBe(200);
  expect(Object.keys((await full.json()).characters)).toEqual(expect.arrayContaining(['M', 'P', 'W']));
  const requested: { section: string | null; status: number }[] = [];
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.endsWith('/party-api/state')) requested.push({ section: url.searchParams.get('section'), status: response.status() });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'M', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Bank', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Bank', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Market', exact: true }).click();
  await expect.poll(() => new Set(requested.map(entry => entry.section)).size).toBeGreaterThanOrEqual(5);
  await info.attach('dashboard-state-requests', { body: JSON.stringify(requested), contentType: 'application/json' });
  for (const entry of requested) {
    expect(known).toContain(entry.section);
    expect([200, 304]).toContain(entry.status);
  }
});
