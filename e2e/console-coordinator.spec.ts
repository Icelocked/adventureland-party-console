import { test, expect } from './fixtures';

// Coordinator hot paths through the real coordinator (docs/efficiency.md, Coordinator).

test('stand price history takes the level of the first listing at the lowest price', async ({ page, app }, info) => {
  const merchant = { ...(await app.state()).characters.M };
  for (const field of ['seenAt', 'inventorySeenAt']) delete merchant[field];
  const listing = (name: string, level: number, price: number, slot: number) =>
    ({ key: `e2e-stand-${slot}`, seller: 'Seller' + slot, item: { name, level }, price, quantity: 1, seenAt: Date.now(), slot: 'trade' + slot, map: 'main', x: 0, y: 0 });
  // Two helmets share the lowest price; a zero-priced coat supplies no price.
  await app.deliverStatus({ ...merchant, nearbyStandListings: [listing('helmet', 7, 900, 1), listing('helmet', 3, 500, 2),
    listing('helmet', 5, 500, 3), listing('coat', 2, 0, 4)] });
  const market = async () => (await (await page.request.get(`${app.url}/party-api/state?section=market&dashboard=1`)).json()).standPriceHistory;
  await expect.poll(async () => (await market())?.helmet?.lowest).toBe(500);
  const history = await market();
  await info.attach('stand-price-history', { body: JSON.stringify(history), contentType: 'application/json' });
  expect(history.helmet).toMatchObject({ lowest: 500, lowestLevel: 3, recent: 500, recentLevel: 3 });
  expect(history.coat).toBeUndefined();
});
