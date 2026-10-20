import { test, expect } from './live-fixtures';

// Failure inventory: e2e/insecure-origin-failures.md. The browser resolves a LAN-style
// hostname to the live console, so the dashboard runs in a real non-secure context
// (no crypto.randomUUID) without stubbing any browser API. Entry and its activation
// are native.
const lan = 'party-lan.test';
test.use({ initialPosition: { map: 'main', x: 816, y: 1180 }, launchOptions: { args: [`--host-resolver-rules=MAP ${lan} 127.0.0.1`] } });

test('Cave entry works from a plain-HTTP LAN origin', async ({ live, page }, info) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(20_000);
  await live.admin('Dev=true; Prod=false; G.events.dreams.disabled=false; output=true');
  await live.post('/formation', { leader: 'E2EWarrior' });
  await live.post('/formation', { character: 'E2EPriest', follow: true });
  const origin = new URL(live.url); origin.hostname = lan;
  const dungeon = async () => (await page.request.get(live.url + '/party-api/daily-dungeons', { maxRetries: 1 })).json();
  const posts: any[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/party-api/daily-dungeons') posts.push(request.postDataJSON());
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  // The shared context aborts non-loopback hosts; this one resolves to 127.0.0.1.
  await page.route(url => url.hostname === lan, route => route.continue());
  try {
    await page.goto(origin.href);
    // The setup itself: a plain-HTTP LAN page is not a secure context.
    expect(await page.evaluate(() => ({ secure: isSecureContext, randomUUID: typeof crypto.randomUUID })))
      .toEqual({ secure: false, randomUUID: 'undefined' });
    const names = ['E2EWarrior', 'E2EPriest'];
    await expect.poll(async () => {
      const view = await dungeon();
      return view.members.length === 2 && names.every(name => {
        const o = view.members.find((m: any) => m.name === name)?.observation;
        return o?.ready && o.alive && o.supported && o.visit?.available && !o.cave && o.leader === 'E2EWarrior';
      });
    }, { timeout: 120_000 }).toBe(true);
    await page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'E2EWarrior', exact: true }) }).getByRole('button', { name: /^Events/ }).click();
    await page.getByRole('button', { name: 'Cave of Many Dreams settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Cave of Many Dreams', exact: true });
    await expect(settings).toBeVisible();

    // 1-3: two setting changes and an entry each reach the coordinator with their own valid ID.
    const protection = settings.getByRole('checkbox', { name: /Don.t leave the Cave of Many Dreams/ });
    for (let i = 0; i < 2; i++) {
      const [response] = await Promise.all([page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/party-api/daily-dungeons'), protection.click()]);
      expect(response.status(), 'Each settings action must be accepted').toBe(200);
    }
    let accepted = false;
    await expect.poll(async () => {
      if (accepted || (await dungeon()).state.phase === 'active') return (await dungeon()).state.phase === 'active';
      const [response] = await Promise.all([page.waitForResponse(r => r.request().method() === 'POST' &&
        new URL(r.url()).pathname === '/party-api/daily-dungeons' && r.request().postDataJSON()?.action === 'enter'),
      settings.getByRole('button', { name: 'Enter now', exact: true }).click()]);
      const body = await response.json();
      if (response.status() === 409 && /fresh dungeon-compatible runtime required$/.test(body.error)) return false;
      expect(response.status(), 'Entry from the LAN origin must be accepted').toBe(200);
      accepted = true;
      return body.state.phase === 'active';
    }, { timeout: 90_000 }).toBe(true);
    const ids = posts.map(post => post.operationId);
    expect(ids.every(id => typeof id === 'string' && id.length > 0 && id.length <= 160)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(errors).toEqual([]);
  } finally {
    await info.attach('insecure-origin-cave-actions', { body: JSON.stringify({ posts, errors, view: await dungeon().catch(String) }), contentType: 'application/json' });
  }
});
