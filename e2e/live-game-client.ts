import type { BrowserContext, Page, Frame } from '@playwright/test';
import {randomUUID} from 'node:crypto';

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
  await installNativeObservers(native);
  await native.evaluate(({ coordinator, primary }) => {
    const game = window as any;
    if (!primary) game.start_runner('maincode', `$.getScript(${JSON.stringify(coordinator + '/CODE/adventure_land/universal-loader.js')});`);
  }, { coordinator: options.coordinatorUrl, primary: !!options.primary });
  await native.waitForFunction(() => {
    const runner = (document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
    return runner?.__partyStatusSuccessAt > 0 && runner?.partyRoleRunner;
  }, undefined, { timeout: 90_000 });
  const eventLedger:Array<{sequence:number;[key:string]:unknown}>=[];
  const eventKeys:string[]=[];
  const seenEvents=new Set<string>();
  let lastEventGeneration='',lastEventSequence=0;
  async function installNativeObservers(frame:Frame):Promise<void> {
    await frame.evaluate(generation=>{
      const game=window as any,socket=game.socket;
      if(!game.character || !socket)throw Error('Native game not initialized');
      game.__e2eEvents ||= [];
      game.__e2eObserverGeneration ||= generation;
      game.__e2eEventSequence ||= 0;
      const observed:WeakSet<object>=game.__e2eObservedSockets ||= new WeakSet();
      if(observed.has(socket))return;
      observed.add(socket);
      // Passive observations only; no native method replacement or synthetic packet.
      for(const event of ['hit','death','game_response','game_log','chest_opened','disappear','new_map','party_update','player'])socket.on(event,(data:unknown)=>{
        game.__e2eEvents.push({sequence:++game.__e2eEventSequence,at:Date.now(),event,data:JSON.parse(JSON.stringify(data ?? null))});
        if(game.__e2eEvents.length>2000)game.__e2eEvents.shift();
      });
    },randomUUID());
  }
  async function retainEvents(frame:Frame):Promise<void> {
    const observed=await frame.evaluate(({generation,sequence})=>{
      const game=window as any;
      const current=String(game.__e2eObserverGeneration);
      const events=game.__e2eEvents as Array<{sequence:number;[key:string]:unknown}>;
      return {generation:current,events:events.filter(event=>current!==generation || event.sequence>sequence)};
    },{generation:lastEventGeneration,sequence:lastEventSequence});
    if(observed.generation!==lastEventGeneration)lastEventSequence=0;
    lastEventGeneration=observed.generation;
    for(const event of observed.events){
      lastEventSequence=Math.max(lastEventSequence,event.sequence);
      const key=observed.generation+':'+event.sequence;
      if(seenEvents.has(key))continue;
      seenEvents.add(key);eventKeys.push(key);eventLedger.push(event);
      if(eventLedger.length>2000){eventLedger.shift();seenEvents.delete(eventKeys.shift()!);}
    }
  }
  function currentGameFrame(): Frame {
    const prefix='/character/'+encodeURIComponent(options.name)+'/';
    const frame=page.frames().find(candidate=>{
      try{return new URL(candidate.url()).pathname.startsWith(prefix);}catch{return false;}
    });
    if(!frame)throw Error('Native character window unavailable for '+options.name);
    native=frame;return frame;
  }
  async function observe<T>(read:(frame:Frame)=>Promise<T>):Promise<T> {
    const deadline=Date.now()+30_000;
    let last:unknown;
    do {
      try{
        const frame=currentGameFrame();await installNativeObservers(frame);
        return await read(frame);
      }
      catch(error){
        if(page.isClosed() || !/Execution context was destroyed|Cannot find context|Frame was detached|Native character window unavailable|Native game not initialized|Native CODE runner missing/.test(String(error)))throw error;
        last=error;await new Promise(resolve=>setTimeout(resolve,100));
      }
    }while(Date.now()<deadline);
    throw last;
  }
  return {
    page, get frame(){return currentGameFrame();}, errors,
    async snapshot() {
      return observe(frame=>frame.evaluate(() => {
        const game = window as any, c = game.character;
        if(!c || !game.socket)throw Error('Native game not initialized');
        const runner = (document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
        return JSON.parse(JSON.stringify({ name: c.name, map: c.map, x: c.real_x, y: c.real_y, hp: c.hp, mp: c.mp,
          gold: c.gold, xp: c.xp, rip: c.rip, items: c.items, slots: c.slots, s: c.s, party: c.party,
          connected: game.socket.connected, codeActive: game.code_active, statusAt: runner?.__partyStatusSuccessAt,
          runtimeGeneration: runner?.__partyRuntimeGeneration }));
      }));
    },
    async events() { return observe(async frame=>{await retainEvents(frame);return [...eventLedger];}); },
    async run(expression) {
      // Reacquire before evaluation; never replay a potentially mutating expression.
      const frame=await observe(async game=>{
        const code=game.childFrames().find(candidate=>candidate.name()==='maincode'||new URL(candidate.url()).pathname==='/runner');
        if(!code || !await code.evaluate(()=>!!(globalThis as any).sharedRoutine && !!(globalThis as any).partyRoleRunner))
          throw Error(`Native CODE runner missing for ${options.name}`);
        return code;
      });
      return frame.evaluate(expression);
    },
  };
}
