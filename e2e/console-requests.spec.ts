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

// Waits in the page for `selector` (inside the open Bank dialog) to satisfy
// `state`, timed from the moment before `act` runs.
async function timed(page: import('@playwright/test').Page, selector: string, state: string, act: () => Promise<unknown>) {
  await page.evaluate(([selector, state]) => {
    const test = () => {
      const element = document.querySelector(selector);
      if (state === 'present') return !!element;
      if (!element) return false;
      if (state.startsWith('class:')) return element.className.includes(state.slice(6));
      if (state.startsWith('!class:')) return !element.className.includes(state.slice(7));
      if (state.startsWith('text:')) return (element.textContent || '').includes(state.slice(5));
      if (state.startsWith('!text:')) return !(element.textContent || '').includes(state.slice(6));
      return false;
    };
    const started = performance.now();
    (window as any).__partyTimed = new Promise<number>(resolve => {
      const check = () => { if (test()) { observer.disconnect(); resolve(performance.now() - started); } };
      const observer = new MutationObserver(check);
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      check();
    });
  }, [selector, state]);
  await act();
  return Math.round(await page.evaluate(() => (window as any).__partyTimed));
}

test('bank tab shows marks, unmarks, withdrawals, rules and bank changes as fast as before', async ({ page, app }, info) => {
  const initial = await app.state();
  const sword = initial.characters.M.items.find((entry: any) => entry?.item?.name === 'sword');
  const catalog = (name: string) => initial.merchantCatalog.allItems.find((entry: any) => entry.id === name);
  const bank = (extra: string[]) => ({ gold: 100000, packs: { items0: [{ ...sword, slot: 0, item: { ...sword.item, level: 0 } },
    ...extra.map((name, index) => ({ slot: index + 1, item: { name, q: 1 }, meta: catalog(name).meta }))] } });
  const checkpoint = (extra: string[]) => page.request.post(`${app.url}/party-api/bankboi/checkpoint`, { headers: { Origin: app.url }, data: { character: 'M', bank: bank(extra) } });
  expect((await checkpoint([])).ok()).toBe(true);
  const sections: { section: string | null; status: number }[] = [];
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.endsWith('/party-api/state')) sections.push({ section: url.searchParams.get('section'), status: response.status() });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'M', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Bank', exact: true }).click();
  const pane = page.getByRole('dialog', { name: 'Bank', exact: true });
  const label = sword.meta.definition.name || 'sword';
  await expect(pane.getByLabel(label, { exact: true })).toBeVisible();
  const tile = `[role="dialog"] [aria-label="${label}"]`;
  const menu = page.locator('[data-slot="context-menu-content"]');
  const choose = async (name: string) => {
    await pane.getByLabel(label, { exact: true }).click({ button: 'right' });
    await menu.getByRole('menuitem', { name, exact: true }).click();
  };
  const confirm = (name: string) => page.getByRole('dialog').last().getByRole('button', { name, exact: true }).click();
  const latency: Record<string, number[]> = { markWithdrawal: [], unmarkWithdrawal: [], markNpcSale: [], clearMarks: [], bankChange: [] };
  for (let round = 0; round < 3; round++) {
    latency.markWithdrawal.push(await timed(page, tile, 'class:border-amber-400', () => choose('Mark for withdrawal')));
    latency.unmarkWithdrawal.push(await timed(page, tile, '!class:border-amber-400', () => choose('Unmark withdrawal')));
    await choose('Sell to NPC…');
    latency.markNpcSale.push(await timed(page, tile, 'text:NPC sale', () => confirm('Sell to NPC')));
    latency.clearMarks.push(await timed(page, tile, '!text:NPC sale', () => choose('Clear all marks')));
  }
  // Each change lands at a different point of the 2 s bank poll.
  const extras = ['coat', 'helmet', 'shoes', 'gloves', 'pants'];
  for (let index = 0; index < extras.length; index++) {
    await page.waitForTimeout(index * 400);
    const name = catalog(extras[index]).meta.definition.name || extras[index];
    latency.bankChange.push(await timed(page, `[role="dialog"] [aria-label="${name}"]`, 'present', () => checkpoint(extras.slice(0, index + 1))));
  }
  await choose('Auto sell to NPC…');
  const rule = page.getByRole('dialog').last();
  await info.attach('auto-npc-dialog', { body: await rule.innerText(), contentType: 'text/plain' });
  const enable = rule.getByRole('button').filter({ hasNotText: /^(Cancel|Close)$/ }).last();
  latency.autoNpcRule = [await timed(page, tile, 'text:Auto NPC', () => enable.click())];
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = Object.fromEntries(Object.entries(latency).map(([name, values]) => [name, { median: median(values), max: Math.max(...values), values }]));
  const bankReads = sections.filter(entry => entry.section === 'bank');
  await info.attach('bank-tab-latency', { body: JSON.stringify({ summary, bankReads: { total: bankReads.length, notModified: bankReads.filter(entry => entry.status === 304).length } }, null, 1), contentType: 'application/json' });
  console.log('bank-tab-latency', JSON.stringify({ summary, bankReads: { total: bankReads.length, notModified: bankReads.filter(entry => entry.status === 304).length } }));
  // Unchanged polls answer 304 and keep the shown bank.
  expect(bankReads.filter(entry => entry.status === 304).length).toBeGreaterThan(0);
  // The bank section polls every 2 s; a change shows within one poll plus the request.
  for (const value of latency.bankChange) expect(value).toBeLessThan(4000);
});

test('console deployment reports the missing activation record the loader would get a 404 for', async ({ app }, info) => {
  const control = await (await fetch(`${app.url}/party-api/console-deployment`)).json();
  const record = await fetch(`${app.url}/CODE/adventure_land/activation.json`);
  await info.attach('console-deployment', { body: JSON.stringify({ control, record: record.status }), contentType: 'application/json' });
  expect(control).toEqual(expect.objectContaining({ activation: null, consoleMaintenance: null }));
  expect(record.status).toBe(404);
});
