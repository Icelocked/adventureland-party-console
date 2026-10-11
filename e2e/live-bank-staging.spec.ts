import type { Page } from '@playwright/test';
import { test, expect, type LiveGame } from './live-fixtures';

// Failure inventory: e2e/bank-staging-failures.md. Without a BankBoi, items1 slots 35–41 are
// ordinary bank space: a real merchant sorts through them, nothing there becomes BankBoi cargo,
// and the dashboard shows no RESERVED row. Once a BankBoi exists the row is staging again.
const merchant = 'E2EMerchant';
const bankboi = 'E2EBankboi';
type Cell = { pack: string; slot: number; item: { name: string; level?: number; q?: number } | null };

async function nativeBank(live: LiveGame, packs: string[]): Promise<Cell[]> {
  return live.admin(`output=(async()=>{const p=get_player('${merchant}'),user=p.user||(await db.collection('user').findOne({_id:p.owner})).info;
    return ${JSON.stringify(packs)}.flatMap(pack=>Array.from({length:42},(_,slot)=>{const item=user[pack][slot];
      return {pack,slot,item:item?{name:item.name,level:item.level,q:item.q}:null}}))})()`);
}
async function visitBank(live: LiveGame) {
  const before = (await live.state()).bank?.seenAt || 0;
  await live.post('/command', { character: merchant, type: 'bank' });
  await expect.poll(async () => ((await live.state()).bank?.seenAt || 0) > before, { timeout: 120_000 }).toBe(true);
  await expect.poll(async () => {
    const state = await live.state();
    return !state.merchantCurrent && !/^bank/.test(state.characters[merchant]?.map || '');
  }, { timeout: 180_000, message: 'The merchant must finish the visit and leave the bank' }).toBe(true);
}
const staging = (cells: Cell[]) => cells.filter(cell => cell.pack === 'items1' && cell.slot >= 35);
/** The header button can be clicked before hydration; retry until the pane is open. */
async function openBank(page: Page) {
  const pane = page.getByRole('dialog', { name: 'Bank', exact: true });
  await expect(async () => {
    await page.getByRole('button', { name: 'Inspect bank', exact: true }).click();
    await expect(pane).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 60_000 });
  await expect(pane.getByText('items1', { exact: true })).toBeVisible({ timeout: 30_000 });
  return pane;
}
const names = (cells: Cell[]) => cells.filter(cell => cell.item).map(cell => cell.item!.name).sort();

test('without a BankBoi the staging row is ordinary bank space, and a BankBoi reserves it again', async ({ live, page }, info) => {
  test.setTimeout(900_000);
  await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'auto npc sales': false } });
  await live.post('/merchant/bank-sort', { mode: 'automatic', layout: 'packed' });

  // Declared fixture: 77 distinct non-stacking items fill items0 and items1 slots 0–34, and one
  // more sits in staging slot 40. Sorting packed must use slot 35 to hold all 78 without a gap.
  const seeded = await live.admin(`output=(async()=>{
    const p=get_player('${merchant}'),user=await db.collection('user').findOne({_id:p.owner});
    const packs=['items0','items1'];
    if(!packs.every(k=>Array.isArray(user.info[k])&&bank_packs[k]&&bank_packs[k][0]==='bank'))throw Error('first-floor items0/items1 required');
    const pool=Object.keys(G.items).filter(n=>!G.items[n].ignore&&(G.items[n].upgrade||G.items[n].compound)).sort().slice(0,78);
    const patch={};for(const pack of packs)for(let slot=0;slot<42;slot++)patch['info.'+pack+'.'+slot]=null;
    const slots=packs.flatMap(pack=>Array.from({length:pack==='items1'?35:42},(_,slot)=>[pack,slot]));
    pool.slice(1).forEach((name,i)=>{patch['info.'+slots[i][0]+'.'+slots[i][1]]={name,level:0};});
    patch['info.items1.40']={name:pool[0],level:0};
    await db.collection('user').updateOne({_id:p.owner},{$set:patch});
    return {packs,items:pool};
  })()`);
  expect(Object.keys((await live.state()).bankbois || {}), 'The fixture starts without a BankBoi').toEqual([]);

  // 1. No BankBoi: the sort uses the row, nothing is lost, and nothing becomes BankBoi cargo.
  await visitBank(live);
  const sorted = await nativeBank(live, seeded.packs);
  expect(names(sorted), 'Every seeded item stays in the bank exactly once').toEqual([...seeded.items].sort());
  const occupied = sorted.map(cell => !!cell.item);
  expect(occupied.indexOf(false), 'Packed sorting fills slot 35 instead of skipping the row').toBe(seeded.items.length);
  expect(occupied.slice(seeded.items.length).some(Boolean), 'No item is left behind in the row').toBe(false);
  await new Promise(resolve => setTimeout(resolve, 5000));
  expect((await live.state()).bankboiQueue || [], 'Row items are not BankBoi cargo without a BankBoi').toEqual([]);

  // Dashboard: the bank pane shows no RESERVED row.
  await page.goto(live.url);
  let pane = await openBank(page);
  await expect(pane.getByText('RESERVED', { exact: true })).toHaveCount(0);
  await info.attach('bank-staging-no-bankboi', { body: await pane.screenshot(), contentType: 'image/png' });

  // 2. A BankBoi exists (saved state, as after creation): the row is staging again. It is idle, so
  // it has no storage work until row items become its cargo.
  await live.restoreHistoricalSettings(() => ({
    bankbois: { [bankboi]: { name: bankboi, state: 'idle', items: [], slots: {}, gold: 0, createdAt: Date.now() } },
  }));
  const stagedItem = staging(sorted).find(cell => cell.item)!.item!;
  await page.reload();
  pane = await openBank(page);
  await expect(pane.getByText('RESERVED', { exact: true })).toHaveCount(7);
  await info.attach('bank-staging-with-bankboi', { body: await pane.screenshot(), contentType: 'image/png' });
  await page.keyboard.press('Escape');

  // The merchant sorts again and leaves the row alone: two normal slots are swapped so the sort has
  // work, and a new first-sorting item placed in slot 38 stays put.
  const normal = (cells: Cell[]) => cells.filter(cell => !(cell.pack === 'items1' && cell.slot >= 35)).map(cell => cell.item?.name ?? null);
  const extra = await live.admin(`output=(async()=>{
    const p=get_player('${merchant}'),user=(await db.collection('user').findOne({_id:p.owner})).info;
    const name=Object.keys(G.items).filter(n=>!G.items[n].ignore&&(G.items[n].upgrade||G.items[n].compound)).sort()[78];
    await db.collection('user').updateOne({_id:p.owner},{$set:{'info.items1.38':{name,level:0},'info.items0.0':user.items0[1],'info.items0.1':user.items0[0]}});
    return name})()`);
  const before = (await live.state()).bank?.seenAt || 0;
  await live.post('/command', { character: merchant, type: 'bank' });
  await expect.poll(async () => normal(await nativeBank(live, seeded.packs)), { timeout: 240_000, intervals: [3000],
    message: 'The merchant visits and sorts the normal slots again' }).toEqual(normal(sorted));
  const reserved = await nativeBank(live, seeded.packs);
  expect(reserved.find(cell => cell.pack === 'items1' && cell.slot === 38)?.item?.name, 'Sorting skips the staging row').toBe(extra);
  expect(names(reserved)).toEqual([...seeded.items, extra].sort());
  // Adoption follows the bank snapshot from that visit: everything in the row is cargo for the BankBoi.
  await expect.poll(async () => ((await live.state()).bank?.seenAt || 0) > before, { timeout: 60_000 }).toBe(true);
  await expect.poll(async () => ((await live.state()).bankboiQueue || []).map((request: any) => request.item?.name).sort(),
    { timeout: 60_000, message: 'Items in the row become cargo for the new BankBoi' }).toEqual([stagedItem.name, extra].sort());
  await info.attach('bank-staging-evidence', { body: JSON.stringify({ seeded, sorted: staging(sorted), reserved: staging(reserved),
    queue: (await live.state()).bankboiQueue }, null, 2), contentType: 'application/json' });
});
