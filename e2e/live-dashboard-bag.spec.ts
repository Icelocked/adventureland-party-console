import { test, expect, type LiveGame } from './live-fixtures';

// Failure inventory: e2e/dashboard-bag-failures.md. A dashboard viewer reads the fighter's bag
// from /party-api/dashboard-stream. The viewer disconnects, a seeded item leaves the bag, and a
// reconnecting viewer must see the bag the game reports. Declared input: the seeded and removed
// items (administrative writes to the native bag); sampling, telemetry and the stream are native.
const W = 'E2EWarrior';

interface Viewer { bag(): Record<string, string | null>; sample(): number; close(): void; }

async function viewer(live: LiveGame): Promise<Viewer> {
  const abort = new AbortController();
  const response = await fetch(live.url + '/party-api/dashboard-stream', { signal: abort.signal });
  let items: Record<string, any> = {}, sample = 0, buffer = '';
  const accept = (message: any) => {
    const record = message.characters?.[W];
    if (message.type === 'snapshot') items = {};
    if (!record) return;
    items = { ...items, ...record.items };
    sample = record.sample;
  };
  void (async () => {
    const reader = response.body!.getReader(), decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const line = buffer.slice(0, end).split('\n').find(text => text.startsWith('data: '));
          buffer = buffer.slice(end + 2);
          if (line) accept(JSON.parse(line.slice(6)));
        }
      }
    } catch { /* closed */ }
  })();
  return {
    bag: () => Object.fromEntries(Object.entries(items).map(([slot, entry]) => [slot, entry?.item?.name ?? null])),
    sample: () => sample,
    close: () => abort.abort(),
  };
}

const gameBag = (live: LiveGame) => live.clients[W].run(`Object.fromEntries(character.items.map((item, slot) => [String(slot), item ? item.name : null]))`);
const occupied = (bag: Record<string, string | null>) => Object.fromEntries(Object.entries(bag).filter(([, name]) => name));

test('a slot emptied while no dashboard is connected is empty for the next viewer', async ({ live }, info) => {
  test.setTimeout(300_000);
  const trials: any[] = [];
  try {
    for (let trial = 0; trial < 5; trial++) {
      const first = await viewer(live);
      // 3: with a viewer connected, the seeded item arrives as a fast-telemetry delta.
      const slot = await live.admin(`output=(()=>{const p=get_player('${W}');const i=p.items.findIndex(x=>!x);if(i<0)throw Error('bag full');
        p.items[i]={name:'ringsj',level:0};cache_player_items(p);resend(p,'u+cid+reopen');return i})()`);
      await expect.poll(() => first.sample() > 0 && first.bag()[String(slot)], { timeout: 30_000, message: 'The seeded ring must reach the connected viewer' }).toBe('ringsj');
      // 1: the viewer leaves; the ring leaves the bag before the fighter's lease lapses.
      first.close();
      await live.admin(`output=(()=>{const p=get_player('${W}');p.items[${slot}]=null;cache_player_items(p);resend(p,'u+cid+reopen');return true})()`);
      await expect.poll(() => live.clients[W].run(`character.items[${slot}]?.name ?? null`), { timeout: 10_000 }).toBe(null);
      await new Promise(resolve => setTimeout(resolve, 4000));
      // 2: the next viewer's bag matches the game's.
      const second = await viewer(live);
      await expect.poll(() => Object.keys(second.bag()).length, { timeout: 15_000 }).toBeGreaterThan(0);
      await new Promise(resolve => setTimeout(resolve, 3000));
      const game = await gameBag(live), shown = second.bag();
      trials.push({ trial, slot, game: occupied(game), shown: occupied(shown) });
      second.close();
      expect(occupied(shown), `Trial ${trial}: the reconnecting viewer must show the game's bag`).toEqual(occupied(game));
      await new Promise(resolve => setTimeout(resolve, 4000));
    }
  } finally {
    await info.attach('dashboard-bag', { body: JSON.stringify({ trials }), contentType: 'application/json' });
  }
});
