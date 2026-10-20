import { test, expect } from './live-fixtures';

// Failure inventory: e2e/prim-stack-failures.md (#65). Grace is never sent to
// game clients, so every grace check reads the native item on the game server.
// The declared inputs are the merchant's seeded inventory; every upgrade
// operation, supply count and preview response is native.
const merchant = 'E2EMerchant';
const native = (live: { admin(code: string): Promise<any> }) => live.admin(`output=(()=>{const p=get_player('${merchant}');
  const count=name=>p.items.filter(i=>i&&i.name===name).reduce((n,i)=>n+(i.q||1),0);
  return {helmet:p.items[20],primlings:count('offeringp'),essence:count('offering'),strscrolls:count('strscroll'),q:p.q};})()`);

test('prim stacking raises native grace to the target through the dashboard and never overshoots', async ({ live, page }, info) => {
  test.setTimeout(360_000);
  const observations: any[] = [];
  // The status report holds the upgrade placeholder briefly after each operation;
  // a request names the item as the dashboard last saw it, so wait for it to report back.
  const reported = () => expect.poll(async () => (await live.state()).characters[merchant]?.items?.find((entry: any) => entry?.slot === 20)?.item,
    { timeout: 30_000 }).toEqual({ name: 'helmet', level: 0, stat_type: 'str' });
  try {
    await expect.poll(async () => Date.now() - ((await live.state()).characters[merchant]?.seenAt || 0), { timeout: 90_000 }).toBeLessThan(3_000);
    const seeded = await live.admin(`output=(()=>{const p=get_player('${merchant}');
      for(const slot of [20,21,22,23,24]) if(p.items[slot]) throw Error('Prim stack fixture requires empty inventory cells 20-24');
      p.items[20]={name:'helmet',level:0,stat_type:'str'};p.items[21]={name:'offeringp',q:4};
      p.items[22]={name:'strscroll',q:2};p.items[23]={name:'offering',q:1};p.items[24]={name:'scroll0',q:1};
      cache_player_items(p);resend(p,'reopen+cid');return p.items.slice(20,25);})()`);
    await info.attach('declared-merchant-inventory', { body: JSON.stringify(seeded), contentType: 'application/json' });
    await expect.poll(async () => (await live.state()).characters[merchant]?.items?.find((entry: any) => entry?.slot === 20)?.item?.name, { timeout: 30_000 }).toBe('helmet');
    const luckyBefore = JSON.stringify((await live.state()).luckySlotTracking?.[merchant] ?? null);

    // 1, 2, 3, 9: the dashboard action stacks with Primling only, up to the target.
    await page.goto(live.url);
    const card = page.locator('article').filter({ has: page.getByRole('heading', { name: merchant, exact: true }) });
    const inventory = card.getByRole('button', { name: /^Inventory/ });
    await expect(async () => {
      if (await inventory.getAttribute('aria-expanded') !== 'true') await inventory.click();
      await card.getByLabel('Helmet', { exact: true }).click({ button: 'right' });
      await page.getByRole('menuitem', { name: /^Mark for upgrade/ }).click();
      await page.getByRole('menuitem', { name: 'Prim stack…', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Prim stack' })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
    const dialog = page.getByRole('dialog', { name: 'Prim stack' });
    await dialog.getByLabel('Target grace').selectOption('1');
    await dialog.getByRole('radio', { name: /Primling only/ }).check();
    await info.attach('prim-stack-dialog', { body: await page.screenshot(), contentType: 'image/png' });
    await dialog.getByRole('button', { name: 'Stack grace' }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect.poll(async () => { const n = await native(live); observations.push({ at: Date.now(), stage: 'primling', n }); return n.helmet?.grace ?? 0; },
      { timeout: 180_000, intervals: [500, 1000] }).toBe(1);
    let after = await native(live);
    expect(after).toMatchObject({ primlings: 2, essence: 1, strscrolls: 2 });
    expect(after.helmet).toMatchObject({ name: 'helmet', level: 0, stat_type: 'str' });

    // 2, 4, 5: the stat-scroll method spends one Primling and the grade's scroll count for +1.
    await reported();
    await live.post('/prim-stack', { character: merchant, slot: 20, item: { name: 'helmet', level: 0, stat_type: 'str' }, target: 2, method: 'stat' });
    await expect.poll(async () => { const n = await native(live); observations.push({ at: Date.now(), stage: 'stat', n }); return n.helmet?.grace ?? 0; },
      { timeout: 180_000, intervals: [500, 1000] }).toBe(2);
    await expect.poll(async () => !(await live.state()).merchantCurrent, { timeout: 60_000 }).toBe(true);
    after = await native(live);
    expect(after).toMatchObject({ primlings: 1, essence: 1, strscrolls: 1 });
    expect(after.helmet).toMatchObject({ name: 'helmet', level: 0, stat_type: 'str' });

    // 3: a repeated request at the reached target spends nothing.
    await reported();
    await live.post('/prim-stack', { character: merchant, slot: 20, item: { name: 'helmet', level: 0, stat_type: 'str' }, target: 2, method: 'offering' });
    await expect.poll(async () => (await live.state()).merchantActivity.some((entry: any) => /already has grace 2/.test(entry.message)), { timeout: 120_000 }).toBe(true);
    after = await native(live);
    expect(after).toMatchObject({ primlings: 1, essence: 1, strscrolls: 1 });
    expect(after.helmet.grace).toBe(2);

    // 8: invalid requests queue nothing.
    const item = { name: 'helmet', level: 0, stat_type: 'str' };
    await expect(live.post('/prim-stack', { character: merchant, slot: 20, item, target: 0, method: 'offering' })).rejects.toThrow(/target/i);
    await expect(live.post('/prim-stack', { character: merchant, slot: 20, item, target: 3, method: 'scroll' })).rejects.toThrow(/method/i);
    await expect(live.post('/prim-stack', { character: merchant, slot: 20, item: { name: 'helmet', level: 1 }, target: 3, method: 'offering' })).rejects.toThrow(/changed/i);
    await expect(live.post('/prim-stack', { character: 'E2EWarrior', slot: 20, item, target: 3, method: 'offering' })).rejects.toThrow(/merchant inventory/i);
    await expect(live.post('/prim-stack', { character: merchant, slot: 23, item: { name: 'offering', q: 1 }, target: 3, method: 'offering' })).rejects.toThrow(/upgrade/i);

    // 9: the chances panel shows the native grace after a refresh.
    await page.goto(live.url);
    await expect(async () => {
      if (await inventory.getAttribute('aria-expanded') !== 'true') await inventory.click();
      await card.getByLabel('Helmet', { exact: true }).click({ button: 'right' });
      await page.getByRole('menuitem', { name: /^Mark for upgrade/ }).click();
      await expect(page.getByRole('region', { name: 'Upgrade chances' })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
    await page.getByRole('menuitem', { name: 'Refresh chances' }).click();
    await expect(page.getByRole('region', { name: 'Upgrade chances' }).getByText('Grace 2', { exact: true })).toBeVisible({ timeout: 120_000 });
    await info.attach('prim-stack-grace-preview', { body: await page.screenshot(), contentType: 'image/png' });

    // 7: none of these operations is an upgrade-scroll roll.
    expect(JSON.stringify((await live.state()).luckySlotTracking?.[merchant] ?? null)).toBe(luckyBefore);
  } finally {
    await info.attach('native-prim-stack', { body: JSON.stringify({ observations, native: await native(live).catch(String),
      activity: (await live.state()).merchantActivity.slice(-20) }), contentType: 'application/json' });
  }
});
