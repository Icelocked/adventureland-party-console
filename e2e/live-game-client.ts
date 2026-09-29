import type { BrowserContext, Page, Frame } from '@playwright/test';

export interface LiveClientOptions {
  webUrl: string;
  coordinatorUrl: string;
  name: string;
  region: string;
  server: string;
  primary?: LiveClient;
}

export interface LiveClient {
  page: Page;
  frame: Frame;
  errors: string[];
  snapshot(): Promise<any>;
  events(): Promise<any[]>;
  run(expression: string): Promise<any>;
}

/** Connect an unmodified upstream client and run the maintained production CODE loader. */
export async function launchGameClient(context: BrowserContext, options: LiveClientOptions): Promise<LiveClient> {
  for (const address of [options.webUrl, options.coordinatorUrl]) {
    if (!['127.0.0.1', 'localhost'].includes(new URL(address).hostname)) throw new Error('Live E2E requires loopback services');
  }
  const page = options.primary?.page || await context.newPage();
  const errors: string[] = options.primary?.errors || [];
  let native: Frame;
  if (options.primary) {
    // /steam/action login asks the production bridge to use native start_character_runner.
    const handle = await page.waitForSelector('#ichar' + options.name.toLowerCase(), { state: 'attached', timeout: 90_000 });
    const frame = await handle.contentFrame();
    if (!frame) throw Error('Native companion frame missing: ' + options.name);
    native = frame;
  } else {
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ coordinator }) => {
      (window as any).__partyServer = coordinator;
    }, { coordinator: options.coordinatorUrl });
    await page.goto(`${options.webUrl}/character/${encodeURIComponent(options.name)}/in/${options.region}/${options.server}/`, { waitUntil: 'domcontentloaded' });
    native = page.mainFrame();
  }
  await native.waitForFunction(name => {
    const game = window as any;
    return game.character?.name === name && game.socket?.connected && typeof game.start_runner === 'function';
  }, options.name, { timeout: 90_000 });
  await native.evaluate(({ coordinator, primary }) => {
    const game = window as any;
    game.__e2eEvents = [];
    // Observers only: never replace native game functions or synthesize socket responses.
    for (const event of ['hit', 'death', 'game_response', 'game_log', 'chest_opened', 'disappear', 'new_map', 'party_update', 'player']) {
      game.socket.on(event, (data: unknown) => {
        game.__e2eEvents.push({ at: Date.now(), event, data: JSON.parse(JSON.stringify(data ?? null)) });
        if (game.__e2eEvents.length > 2000) game.__e2eEvents.shift();
      });
    }
    if (!primary) game.start_runner('maincode', `$.getScript(${JSON.stringify(coordinator + '/CODE/adventure_land/universal-loader.js')});`);
  }, { coordinator: options.coordinatorUrl, primary: !!options.primary });
  await native.waitForFunction(() => {
    const runner = (document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
    return runner?.__partyStatusSuccessAt > 0 && runner?.partyRoleRunner;
  }, undefined, { timeout: 90_000 });
  return {
    page, frame: native, errors,
    async snapshot() {
      return native.evaluate(() => {
        const game = window as any, c = game.character;
        const runner = (document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
        return JSON.parse(JSON.stringify({ name: c.name, map: c.map, x: c.real_x, y: c.real_y, hp: c.hp, mp: c.mp,
          gold: c.gold, xp: c.xp, rip: c.rip, items: c.items, slots: c.slots, s: c.s, party: c.party,
          connected: game.socket.connected, codeActive: game.code_active, statusAt: runner?.__partyStatusSuccessAt,
          runtimeGeneration: runner?.__partyRuntimeGeneration }));
      });
    },
    async events() { return native.evaluate(() => (window as any).__e2eEvents || []); },
    async run(expression) {
      const frame = native.childFrames().find(candidate => candidate.name() === 'maincode' || new URL(candidate.url()).pathname === '/runner');
      if (!frame) throw new Error(`Native CODE runner missing for ${options.name}`);
      return frame.evaluate(expression);
    },
  };
}
