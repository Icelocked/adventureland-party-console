import { createServer, type IncomingMessage, type Server } from 'node:http';
import { test, expect, type LiveGame } from './live-fixtures';

// Failure inventory: e2e/alninja-report-failures.md. A local stand-in for ALNinja's
// POST /api/v1/observations records what the coordinator forwards. Declared inputs: the
// merchant's stand stock and the fighter's gold (administrative writes to the native players).
// The stand trades, the "+$$" events, trade history, telemetry and the reports are native. For the
// mailed key, the stand-in plays ALNinja's mail pickup: the journey reads the native mail from the game
// database and registers its key with the stand-in.
const W = 'E2EWarrior', M = 'E2EMerchant', token = 'e2e-report-token-0123456789';
const town = { map: 'main', x: -63, y: 100 }; // the merchant's default stand spot
// The coordinator reads PARTY_ALNINJA_URL when its process starts, so the stand-in starts first.
let alninja: Awaited<ReturnType<typeof standIn>>;
test.beforeAll(async () => { alninja = await standIn(); process.env.PARTY_ALNINJA_URL = alninja.url; });
test.afterAll(async () => { delete process.env.PARTY_ALNINJA_URL; await alninja?.close(); });
test.use({ initialPositions: { [W]: { ...town, x: town.x + 30 }, E2EPriest: { ...town, x: town.x - 30 }, [M]: town } });

interface Report { at: number; auth: string | undefined; body: any; status: number }

const keyMail = 'E2EPriest'; // the stand-in's key-mail character

async function standIn() {
  const reports: Report[] = [], keys: Record<string, string> = {};
  let failures = 0;
  // ALNinja's keyOwner: the admin token, or "<Character>:<key>" matching a mailed key.
  const owner = (header?: string) => {
    const value = header?.startsWith('Bearer ') ? header.slice(7) : '';
    if (value === token) return 'admin';
    const [character, key] = value.split(':');
    return character && key && keys[character] === key ? character : null;
  };
  const server: Server = createServer((request: IncomingMessage, response) => {
    let text = '';
    request.on('data', chunk => { text += chunk; });
    request.on('end', () => {
      const reply = (status: number, value: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
      const character = /^\/api\/v1\/auth\/(\w+)$/.exec(request.url || '')?.[1];
      if (request.url === '/api/v1/auth') return reply(200, { enabled: true, mailTo: keyMail, subject: 'alninja_auth' });
      if (character) return reply(200, { character, registered: !!keys[character], ...(request.headers.authorization ? { valid: owner(request.headers.authorization) === character } : {}) });
      let body: any = null;
      try { body = JSON.parse(text); } catch { body = text; }
      const status = request.url !== '/api/v1/observations' || request.method !== 'POST' ? 404
        : !owner(request.headers.authorization) ? 401 : failures > 0 ? (failures--, 500) : 200;
      reports.push({ at: Date.now(), auth: request.headers.authorization, body, status });
      reply(status, status === 200 ? { stored: body?.sales?.length ?? 0, duplicates: 0, unresolved: 0, inView: body?.inView?.length ?? 0 } : { error: 'stand-in failure' });
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, reports, register: (character: string, key: string) => { keys[character] = key; }, failNext: (count: number) => { failures = count; }, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

const accepted = (reports: Report[], reporter: string) => reports.filter(r => r.status === 200 && r.body?.reporter === reporter);
const sold = (reports: Report[], reporter: string) => accepted(reports, reporter).flatMap(r => r.body.sales)
  .filter((s: any) => s.seller === M && s.buyer === W && s.item?.name === 'hpot0');
const bought = (reports: Report[]) => accepted(reports, W).flatMap(r => r.body.history)
  .filter((h: any) => h.event === 'buy' && h.counterparty === M && h.item?.name === 'hpot0');

async function stock(live: LiveGame) {
  await live.admin(`output=(()=>{const m=get_player('${M}'),w=get_player('${W}');
    const free=()=>m.items.findIndex(x=>!x);
    if(!m.items.some(i=>i&&i.name==='stand0')){const i=free();m.items[i]={name:'stand0'};}
    const i=free();m.items[i]={name:'hpot0',q:10};cache_player_items(m);resend(m,'u+cid+reopen');
    w.gold=Math.max(w.gold,1000000);resend(w,'u+cid');return i})()`);
}

test('the party reports witnessed stand trades and its own trades to ALNinja, with coverage and retries', async ({ live }, info) => {
  test.setTimeout(480_000);
  const timeline: any[] = [];
  try {
    // 8: nothing is sent while reporting is off.
    await new Promise(resolve => setTimeout(resolve, 8000));
    expect(alninja.reports, 'No report may be sent before reporting is enabled').toEqual([]);
    // 1: the setting is saved and the token never comes back.
    const saved = await live.post('/alninja', { enabled: true, token });
    expect(JSON.stringify(saved)).not.toContain(token);
    const visible = (await live.state()).alninja;
    expect(visible).toMatchObject({ enabled: true, hasToken: true, reporting: true });
    expect(JSON.stringify(visible)).not.toContain(token);
    // 9, 4: every character reports, with the token, ALNinja's fields, and the open stand in view.
    await stock(live);
    // The console owns the merchant's stand, so the potions are listed through it, as from the dashboard.
    const potions = await live.clients[M].run(`character.items.findIndex(x=>x&&x.name==='hpot0')`);
    timeline.push({ listed: await live.post('/merchant/stand', { slot: potions, item: { name: 'hpot0', q: 10 }, price: 100, quantity: 10 }) });
    const listing = `Object.entries(get_player('${M}')?.slots||{}).find(([k,v])=>k.startsWith('trade')&&v&&v.name==='hpot0'&&!v.b)?.[0]??null`;
    await expect.poll(() => live.clients[W].run(listing), { timeout: 120_000, message: 'The fighter must see the listed potions' }).toMatch(/^trade\d+$/);
    await expect.poll(() => accepted(alninja.reports, W).some(r => r.body.inView.includes(M)), { timeout: 90_000, message: 'The fighter must report the open stand in view' }).toBe(true);
    for (const reporter of [W, M]) {
      const report = accepted(alninja.reports, reporter)[0];
      expect(report.auth).toBe(`Bearer ${token}`);
      expect(report.body).toMatchObject({ reporter, region: expect.any(String), server: expect.any(String), map: expect.any(String) });
      expect(report.body.inView.every((name: string) => /^[A-Za-z0-9_]{1,40}$/.test(name)), 'inView lists character names only').toBe(true);
      expect(typeof report.body.sentAt).toBe('number');
      for (const field of ['inView', 'sales', 'history']) expect(Array.isArray(report.body[field])).toBe(true);
    }
    // 6: the first report carrying the trade fails and is retried.
    alninja.failNext(2);
    // 2, 5: the fighter buys from the stand twice; both characters see "+$$" and report it quickly.
    const boughtAt = Date.now();
    // The console may refresh its stand at any moment, so the slot is found again before each purchase.
    const result = await live.clients[W].run(`(async()=>{const bought=[];
      for(let n=0;n<2;n++){for(let tries=0;;tries++){const m=get_player('${M}'),slot=Object.entries(m?.slots||{}).find(([k,v])=>k.startsWith('trade')&&v&&v.name==='hpot0'&&!v.b)?.[0];
        if(slot){bought.push(slot);await trade_buy(m,slot,1);break;}if(tries>40)throw Error('listing gone');await new Promise(r=>setTimeout(r,250));}
        await new Promise(r=>setTimeout(r,1500));}
      return bought})()`);
    timeline.push({ boughtAt, result });
    await expect.poll(() => sold(alninja.reports, W).length + sold(alninja.reports, M).length, { timeout: 60_000, message: 'Both characters must report the witnessed trades' }).toBe(4);
    expect(alninja.reports.some(r => r.status === 500 && r.body?.sales?.length), 'A report carrying a trade must have failed first').toBe(true);
    for (const reporter of [W, M]) {
      const sales = sold(alninja.reports, reporter);
      expect(sales, `${reporter} reports each trade once`).toHaveLength(2);
      expect(sales[0]).toMatchObject({ slot: result[0], filledBuyOrder: false, item: { name: 'hpot0', price: 100 } });
    }
    // 3: the fighter's own trade history reports exactly the two units it bought.
    await expect.poll(() => bought(alninja.reports).reduce((n: number, h: any) => n + (h.item.q || 1), 0), { timeout: 150_000, message: 'The fighter must report its own purchases from trade history' }).toBe(2);
    // 4: reports keep arriving at most a minute apart while nothing trades.
    const quietFrom = Date.now();
    await new Promise(resolve => setTimeout(resolve, 130_000));
    const quiet = accepted(alninja.reports, W).filter(r => r.at >= quietFrom).map(r => r.at);
    timeline.push({ quietFrom, quiet });
    expect(quiet.length, 'Coverage reports must continue without trades').toBeGreaterThanOrEqual(2);
    for (let i = 1; i < quiet.length; i++) expect(quiet[i] - quiet[i - 1]).toBeLessThanOrEqual(65_000);
    expect(bought(alninja.reports).reduce((n: number, h: any) => n + (h.item.q || 1), 0), 'Trade history must not be reported twice').toBe(2);
    // 8: turning reporting off stops reports.
    await live.post('/alninja', { enabled: false });
    await new Promise(resolve => setTimeout(resolve, 5000));
    const stoppedAt = alninja.reports.length;
    await new Promise(resolve => setTimeout(resolve, 70_000));
    expect(alninja.reports.length, 'No report may be sent after reporting is disabled').toBe(stoppedAt);
  } finally {
    await info.attach('alninja-reports', { body: JSON.stringify({ timeline, reports: alninja.reports, coordinator: (await live.state().catch(() => ({})))?.alninja }), contentType: 'application/json' });
  }
});

test('a regular user\'s merchant mails a generated key to ALNinja, and reports use it once ALNinja confirms it', async ({ live }, info) => {
  test.setTimeout(360_000);
  const from = alninja.reports.length;
  let mail: any = null;
  try {
    // The coordinator carries over from the admin-token journey; a regular user has no token.
    await live.post('/alninja', { enabled: false, token: '' });
    // 11: a key is generated and stays out of the public state.
    const { key } = await live.post('/alninja/key', {});
    expect(key).toMatch(/^[A-Za-z0-9_-]{16,200}$/);
    const generated = (await live.state()).alninja;
    expect(generated).toMatchObject({ hasKey: true, keyOwner: null, hasToken: false });
    expect(JSON.stringify(generated)).not.toContain(key);
    // 12: with reporting on but the key unconfirmed, nothing is sent.
    await live.post('/alninja', { enabled: true });
    expect((await live.state()).alninja.reporting).toBe(false);
    // 13: the merchant mails the key to ALNinja's key-mail character, as Prepare mail drafts it.
    const response = await fetch(live.url + '/party-api/alninja/auth');
    const instructions = await response.json();
    expect(instructions).toMatchObject({ enabled: true, mailTo: keyMail, subject: 'alninja_auth', merchant: M, registered: false, valid: false });
    await live.post('/merchant/send-mail', { recipient: instructions.mailTo, subject: instructions.subject, message: key });
    // The game stores mail with its subject and message under info.
    await expect.poll(async () => (mail = await live.admin(`output=db.collection('mail').findOne({'info.subject':'alninja_auth','info.message':${JSON.stringify(key)}})`))?.info?.message ?? null,
      { timeout: 180_000, intervals: [3000], message: 'The merchant must send the key mail' }).toBe(key);
    expect(mail).toMatchObject({ fro: M, to: keyMail });
    alninja.register(mail.fro, mail.info.message); // ALNinja's mail pickup
    // 14: the console confirms the key, records the merchant as its owner, and every character reports with it.
    const confirmed = await (await fetch(live.url + '/party-api/alninja/auth')).json();
    expect(confirmed).toMatchObject({ registered: true, valid: true, keyOwner: M });
    expect((await live.state()).alninja).toMatchObject({ keyOwner: M, reporting: true });
    await expect.poll(() => new Set(alninja.reports.slice(from).filter(r => r.status === 200).map(r => r.body.reporter)).size,
      { timeout: 90_000, message: 'Every character must report with the mailed key' }).toBe(3);
    const used = alninja.reports.slice(from).filter(r => r.status === 200);
    expect(used.every(r => r.auth === `Bearer ${M}:${key}`)).toBe(true);
    expect(alninja.reports.slice(from).some(r => r.status === 401), 'No report may be sent before the key is confirmed').toBe(false);
  } finally {
    await info.attach('alninja-key', { body: JSON.stringify({ mail: mail && { fro: mail.fro, to: mail.to, subject: mail.info?.subject }, reports: alninja.reports.slice(from) }), contentType: 'application/json' });
  }
});
