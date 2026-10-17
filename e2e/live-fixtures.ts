import {waitForLiveRestartState, type RestartStateProbe} from './live-restart-readiness';
import { test as base, expect, unusedPort, child, environment, stop } from './fixtures';
import { launchGameClient, type LiveClient } from './live-game-client';
import { type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateway } from '../tools/hosting/gateway';
import { Access } from '../tools/hosting/access';
import { selectionFields, stateKeys } from '../runtime/coordinator/persistence/snapshots';
import { loadouts, seedLoadout, type NativeLoadout } from './game/loadouts';
import { nativeEventSpawn, nativeMonsterInitialPosition } from './game/event-spawn';
import {nativeNetworkIsolation} from './native-network-isolation';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const game = require('./game/bootstrap.cjs');
export type LiveGame = {
  url: string;
  clients: Record<string, LiveClient>;
  state(catalogs?: boolean): Promise<any>;
  savedTownCycle(): {id:string;pending:string[];revisions?:Record<string,number>} | null;
  post(route: string, body: unknown): Promise<any>;
  admin(code: string): Promise<any>;
  adminRealm(realm:'USI'|'USII', code:string):Promise<any>;
  holdMerchantStatus(hold:boolean):void;
  consoleDrainLease(id: string | null, expires?: number, options?:{loadMode?:'now'|'safe'|'main';phase?:string}): void;
  restartCoordinator(): Promise<void>;
  restartCoordinatorIdentity(artifactId:string,hash:string):Promise<void>;
  deploymentPaths:{directory:string;apiUrl:string;codeRoots:string[]};
  restoreHistoricalSettings(restore: (settings: any) => any): Promise<void>;
  reconnectClient(name: string): Promise<void>;
};

export const test = base.extend<{ live: LiveGame; loadout: NativeLoadout; primaryClass: 'warrior' | 'ranger' | 'mage' | 'rogue'; extraFighter: 'mage' | null; merchantDefault: string | null; liveHeadless: boolean; recordNativeVideo: boolean; movementMode: 'alclient' | 'shadow'; staleWorkerRealm: string | null; initialPosition: {map: string; x: number; y: number} | null; initialPositions: Record<string,{map:string;x:number;y:number}> | null; initialEventSpawn: string | null; initialMonsterSpawn: string | null; initialConsoleHold: boolean; initialGatheringReady: boolean }>({
  loadout: ['god', {option:true}],
  primaryClass: ['warrior', {option:true}],
  extraFighter: [null, {option:true}],
  merchantDefault: ['E2EMerchant', {option:true}],
  initialPosition: [null, {option:true}],
  initialPositions: [null, {option:true}],
  initialMonsterSpawn: [null, {option:true}],
  initialConsoleHold: [false, {option:true}],
  initialGatheringReady: [false, {option:true}],
  initialEventSpawn: [null, {option:true}],
  liveHeadless: [false, {option:true}],
  recordNativeVideo: [process.env.E2E_NATIVE_VIDEO==='1', {option:true}],
  movementMode: ['alclient', {option:true}],
  staleWorkerRealm: [null, {option:true}],
  live: [async ({ browser, dashboard, loadout, primaryClass, extraFighter, merchantDefault, initialPosition, initialPositions, initialEventSpawn, initialMonsterSpawn, initialConsoleHold, initialGatheringReady, liveHeadless, recordNativeVideo, movementMode, staleWorkerRealm }, use, testInfo) => {
    const directory = path.join(root, '.build/e2e', `live-${randomUUID()}`);
    mkdirSync(directory, { recursive: true });
    const manifest = await game.reset();
    const names=['E2EWarrior','E2EPriest','E2EMerchant',...(extraFighter?['E2EBankBoi']:[])];
    const equipment = await seedLoadout(game.admin, loadout, primaryClass, extraFighter);
    if(initialGatheringReady){
      const availability=await game.admin(`output=(async()=>{
        if(Object.keys(players).length||Object.keys(dc_players).length)throw Error('Gathering availability requires disconnected native clients');
        const query={owner:data.owner,name:'e2emerchant'},before=await db.collection('character').findOne(query);
        if(!before)throw Error('Owned gathering merchant missing');
        const ready=new Date(0),update=await db.collection('character').updateOne(query,{$set:{'info.p.dt.fishing':ready,'info.p.dt.mining':ready}});
        if(update.matchedCount!==1)throw Error('Gathering availability seed did not match exactly one character');
        const after=await db.collection('character').findOne(query);
        return {name:after.info.name,before:before.info.p.dt||{},after:after.info.p.dt};})()`,{owner:manifest.auth.split('-')[0]});
      await testInfo.attach('declared-native-gathering-ready-before-login',{body:JSON.stringify(availability),contentType:'application/json'});
    }
    if(initialEventSpawn){const spawn=await nativeEventSpawn(game.admin,initialEventSpawn);initialPosition={...spawn,x:spawn.x+160};
      await testInfo.attach('native-event-catalog-initial-position',{body:JSON.stringify({event:initialEventSpawn,spawn,initialPosition}),contentType:'application/json'});}
    if(initialMonsterSpawn){const spawn=await nativeMonsterInitialPosition(game.admin,initialMonsterSpawn);initialPosition={map:spawn.map,x:spawn.x,y:spawn.y};
      await testInfo.attach('native-monster-collision-safe-initial-position',{body:JSON.stringify(spawn),contentType:'application/json'});}
    if (initialPosition) {
      await game.admin("output=db.collection('character').updateMany({owner:data.owner},{$set:{'info.map':data.map,'info.x':data.x,'info.y':data.y}})", { owner: manifest.auth.split('-')[0], ...initialPosition });
      await testInfo.attach('native-initial-position-seed', { body: JSON.stringify(initialPosition), contentType: 'application/json' });
    }
    if(initialPositions){
      if(Object.keys(initialPositions).some(name=>!names.includes(name)))throw Error('Initial positions contain an unowned native fixture character');
      const staging=await game.admin(`output=(async()=>{
        if(Object.keys(players).length||Object.keys(dc_players).length)throw Error('Initial positions require disconnected native clients');
        const result=[];
        for(const [name,point] of Object.entries(data.positions)){
          if(!G.maps[point.map]||!Number.isFinite(point.x)||!Number.isFinite(point.y))throw Error('Invalid declared native position: '+name);
          const body={type:'character',map:point.map,x:point.x,y:point.y};set_base(body);
          const cell=smap_data[point.map]===-1?0:smap_data[point.map]?.[rphash(point.x,point.y)];
          if(!can_move({...body,going_x:point.x,going_y:point.y})||!(cell<2))throw Error('Native geometry rejects declared position: '+name);
          const updated=await db.collection('character').updateOne({name:name.toLowerCase()},{$set:{'info.map':point.map,'info.in':point.map,'info.x':point.x,'info.y':point.y}});
          if(updated.matchedCount!==1)throw Error('Native staging character missing: '+name);
          result.push({name,...point,base:body.base,cell,selfClear:true});
        }return result;})()`,{positions:initialPositions});
      await testInfo.attach('native-separated-initial-positions',{body:JSON.stringify(staging),contentType:'application/json'});
    }
    await testInfo.attach('native-loadout-seed', {body:JSON.stringify(equipment,null,2),contentType:'application/json'});
    await testInfo.attach('live-seed', { body: JSON.stringify({ ...manifest, auth: '[disposable credential omitted]' }, null, 2), contentType: 'application/json' });
    const port = await unusedPort(), log = path.join(directory, 'coordinator.log');
    let coordinator: ChildProcess | undefined;
    let identityEnvironment:NodeJS.ProcessEnv={};
    const blocked: string[] = [];
    const network=await nativeNetworkIsolation(blocked);
    const context = await browser.newContext({proxy:network.proxy, viewport: { width: 1280, height: 900 },
      ...(recordNativeVideo ? {recordVideo: { dir: testInfo.outputPath('native-video'), size: { width: 960, height: 675 } }} : {}) }).catch(async error=>{await network.close();throw error;});
    await testInfo.attach('native-video-recording-policy',{body:JSON.stringify({enabled:recordNativeVideo}),contentType:'application/json'});
    const nativePages = new Set<Page>();
    context.on('page', page => nativePages.add(page));
    await context.addCookies([{ name: 'auth', value: manifest.auth, url: manifest.webUrl }]);
    const access = new Access(path.join(directory, 'access.json'));
    await access.load();
    const server = gateway({ access, configured: () => true, dashboardPort: dashboard.port, apiPort: port });
    let live: LiveGame | undefined;
    const clients: Record<string, LiveClient> = {};
    const exchanges: unknown[] = [];
    const primaryName = 'E2EWarrior';
    const optionsFor = (name: string) => ({ webUrl: manifest.webUrl, coordinatorUrl: `http://127.0.0.1:${port}`,
      name, region: manifest.region, server: manifest.server,
      ...(name === primaryName ? {} : { primary: clients[primaryName] }) });
    async function start() {
      coordinator = child(path.join(root, 'e2e/live-coordinator.cjs'), [], root,
        environment({ E2E_COORDINATOR_PORT: String(port), E2E_DATA_DIR: directory,
          E2E_GAME_WEB_URL: manifest.webUrl, E2E_GAME_AUTH: manifest.auth, E2E_MERCHANT_DEFAULT: JSON.stringify(merchantDefault), E2E_ALLOW_HEADLESS: String(liveHeadless), PARTY_MOVEMENT_MODE: movementMode, E2E_STALE_WORKER_REALM: staleWorkerRealm || '',...identityEnvironment }), log);
      const current = coordinator;
      await new Promise<void>((resolve, reject) => {
        const details = () => existsSync(log) ? readFileSync(log, 'utf8').slice(-16000) : 'No coordinator output';
        const timeout = setTimeout(() => failed(new Error(`Live coordinator startup timed out\n${details()}`)), 90_000);
        const cleanup = () => { clearTimeout(timeout); current.removeListener('message', message); current.removeListener('error', failed); current.removeListener('exit', exited); };
        const failed = (error: Error) => { cleanup(); reject(error); };
        const exited = (code: number | null) => failed(new Error(`Live coordinator exited (${code})\n${details()}`));
        const message = (value: any) => { if (value?.type === 'ready') { cleanup(); resolve(); } };
        current.on('message', message); current.once('error', failed); current.once('exit', exited);
      });
    }
    async function publicRestartReady(reason:string):Promise<void> {
      const observations:RestartStateProbe[]=[];
      try{await waitForLiveRestartState(live!.url,row=>{
        observations.push(row);if(observations.length>32)observations.splice(8,1);
      });}
      finally{exchanges.push({at:Date.now(),coordinatorRestartReadiness:reason,observations});}
    }
    try {
      await start();
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      live = {
        url, clients,
        async state(catalogs = false) {
          // Match the dashboard's existing catalog-free polling API. Catalog checks
          // explicitly request the full projection; never cache or synthesize state.
          const response = await fetch(url + '/party-api/state' + (catalogs ? '' : '?catalog=0'), { signal: AbortSignal.timeout(15_000) });
          if (!response.ok) throw Error('Live state failed: ' + response.status);
          return response.json();
        },
        savedTownCycle() {
          const journal=readFileSync(path.join(directory,'state.jsonl'),'utf8');
          const complete=journal.slice(0,journal.lastIndexOf('\n'));
          const stored=Object.assign({},...complete.split('\n').filter(Boolean).map(line=>JSON.parse(line)));
          const settings=stored[stateKeys.settings];
          const decoded=typeof settings==='string'?JSON.parse(settings):settings;
          return decoded?.townCycle || null;
        },
        async post(route, body) {
          const endpoint = route.startsWith('/party-api/') ? route : '/party-api' + route;
          const response = await fetch(url + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url },
            body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
          const result = await response.json();
          exchanges.push({ at: Date.now(), route: endpoint, body, status: response.status, result });
          if (!response.ok) throw Error(`${endpoint}: ${response.status} ${JSON.stringify(result)}`);
          return result;
        },
        async admin(code) {
          const result = await game.admin(code);
          exchanges.push({ at: Date.now(), administrative: true, code, result });
          return result;
        },
        async adminRealm(realm,code) {
          const result = await game.admin(code,{},realm);
          exchanges.push({at:Date.now(),administrative:true,realm,code,result});
          return result;
        },
        holdMerchantStatus(hold) {
          const marker=path.join(directory,'hold-merchant-status');
          if(hold) writeFileSync(marker,'Declared missing merchant arrival reports');
          else rmSync(marker,{force:true});
          exchanges.push({at:Date.now(),transportFault:'merchant-status',hold});
        },
        consoleDrainLease(id, expires = Date.now()+180000, options={}) {
          const file = path.join(directory,'updates/pause.json');
          mkdirSync(path.dirname(file),{recursive:true});
          if (id) writeFileSync(file,JSON.stringify({id,mode:'draining',expires,...options}));
          else rmSync(file,{force:true});
          exchanges.push({at:Date.now(),hostMaintenanceLease:id,expires});
        },
        async restartCoordinator() { await stop(coordinator!, true); await start(); await publicRestartReady('explicit restart'); },
        deploymentPaths:{directory,apiUrl:`http://127.0.0.1:${port}`,codeRoots:[path.join(root,'.build/CODE/adventure_land'),path.join(directory,'CODE/adventure_land')]},
        async restartCoordinatorIdentity(artifactId,hash){identityEnvironment={AL_CONSOLE_ARTIFACT_ID:artifactId,AL_CONSOLE_COORDINATOR_HASH:hash};await stop(coordinator!,true);await start();await publicRestartReady('identity restart');},
        async restoreHistoricalSettings(restore) {
          await stop(coordinator!, true);
          const journal = path.join(directory, 'state.jsonl');
          const entries = readFileSync(journal, 'utf8').trim().split('\n').map(line => JSON.parse(line));
          const key = 'party_dashboard_settings_state_v1';
          const stored = Object.assign({}, ...entries);
          const decoded = (stateKey: string) => typeof stored[stateKey] === 'string'
            ? JSON.parse(stored[stateKey]) : structuredClone(stored[stateKey] || {});
          const settings = decoded(key);
          const historical = await restore(structuredClone(settings));
          const allowed = new Set(['escape', 'combatRecovery', 'characterLocations', 'location', 'farmingPolicy', 'farmingProfiles', 'eventSelectionsByCharacter', 'activeConvoy', 'deferredEventReturns', 'eventReturn', 'monsterHunt', 'merchantDeliveries', 'npcSaleMarks', 'merchantCurrent', 'merchantQueue', 'merchantRealmRequests', 'autoNpcSales', 'autoStandMarks', 'merchantCharacter', 'bankbois', 'bankboiTransaction', 'production', 'nativeStand', 'standBids', 'luckyUpgradeSlots', 'luckySlotResume', 'luckySlotLocks', 'autoItemMarks', 'autoUpgradeMarks', 'autoCompounds', 'gatheringCooldowns']);
          if (Object.keys(historical).some(key => !allowed.has(key))) throw Error('Historical seed may only patch declared recovery, Hunt, navigation and native WTB settings');
          await testInfo.attach('declared-historical-settings-seed', { body: JSON.stringify(historical), contentType: 'application/json' });
          const bankKeys = new Set(['bankbois', 'bankboiTransaction']);
          const bankPatch = Object.fromEntries(Object.entries(historical).filter(([field]) => bankKeys.has(field)));
          const selectionKeys = new Set<string>(selectionFields);
          const selectionsPatch = Object.fromEntries(Object.entries(historical).filter(([field]) => selectionKeys.has(field)));
          const settingsPatch = Object.fromEntries(Object.entries(historical).filter(([field]) => !bankKeys.has(field) && !selectionKeys.has(field)));
          const restored: Record<string, unknown> = { [key]: { ...settings, ...settingsPatch } };
          if (Object.keys(selectionsPatch).length)
            restored[stateKeys.selections] = { ...decoded(stateKeys.selections), ...selectionsPatch };
          if (Object.keys(bankPatch).length) {
            const bankKey = 'party_dashboard_bank_state_v1';
            restored[bankKey] = { ...decoded(bankKey), ...bankPatch };
          }
          for (const [stateKey, value] of Object.entries(restored))
            appendFileSync(journal, JSON.stringify({ [stateKey]: value }) + '\n');
          await start();
          await publicRestartReady('historical settings restart');
        },
        async reconnectClient(name) {
          if (!clients[name]) throw Error('Unknown owned native client: ' + name);
          const ownership = await live!.state();
          const steamNames = Object.keys(clients).filter(member =>
            ownership.characters[member]?.runtime === 'native');
          if (!steamNames.includes(name)) throw Error('Native browser reconnect requires current Steam ownership: ' + name);
          const companions = steamNames.filter(member=>member!==primaryName);
          const previous = companions.map(member=>clients[member].frame);
          if (name === primaryName) {
            await clients[name].page.close();
            await expect.poll(async () => game.admin(`output=Object.values(players).concat(Object.values(dc_players)).filter(p=>${JSON.stringify(steamNames)}.includes(p.name)).length`), { timeout: 45_000 }).toBe(0);
            clients[primaryName] = await launchGameClient(context, optionsFor(primaryName));
            // Production bridge restores its missing companions after observing the new primary session.
          } else {
            await clients[primaryName].frame.evaluate(name => (window as any).stop_character_runner(name), name);
            await live!.post('/steam/restore', {});
            await expect.poll(() => previous.every(frame => frame.isDetached()), { timeout: 30_000 }).toBe(true);
          }
          for (const companion of companions)
            clients[companion] = await launchGameClient(context, optionsFor(companion));
          await expect.poll(async () => (await live!.state()).steamSwitch?.phase, { timeout: 90_000 }).toBe('complete');
        },
      };
      await live.post('/formation', { leader: null });
      for (const name of names)
        await live.post('/formation', { character: name, follow: false, eventSelections: [] });
      const initial = await live.state();
      await testInfo.attach('merchant-before-native-login', {body: JSON.stringify({merchantDefault, merchantCharacter: initial.merchantCharacter}), contentType: 'application/json'});
      expect(initial.merchantCharacter).toBe(merchantDefault);
      await live.post('/merchant/routine-priorities', { priorities: {},
        enabled: Object.fromEntries(Object.keys(initial.merchantAutomations || {}).map(key => [key, false])) });
      // Keep this serial: failures retain the already connected clients for teardown and evidence.
      let nativeReadyDeadline=0;
      for (const name of names) {
        if (name !== primaryName) {
          await expect.poll(async () => {
            const response = await fetch(`http://127.0.0.1:${port}/party-api/steam/connection`);
            return (await response.json()).ready;
          }, { timeout: 30_000 }).toBe(true);
          const login = await live.post('/steam/action', { character: name, action: 'login' });
          if (login.operation?.phase === 'awaiting-realm-choice')
            await live.post('/steam/realm-choice', { operationId: login.operation.id, choice: 'stay' });
        }
        clients[name] = await launchGameClient(context, optionsFor(name));
        if (name !== primaryName) {
          if(name===names.at(-1))nativeReadyDeadline=Date.now()+90_000;
          await expect.poll(async () => (await live!.state()).steamSwitch?.phase,
            {timeout:name===names.at(-1)?Math.max(1,nativeReadyDeadline-Date.now()):90_000}).toBe('complete');
        }
      }
      await testInfo.attach('live-server-initial', { body: JSON.stringify(await live.admin(`output=Object.fromEntries(Object.values(players).filter(p=>${JSON.stringify(names)}.includes(p.name)).map(p=>[p.name,{name:p.name,map:p.map,x:p.x,y:p.y,hp:p.hp,max_hp:p.max_hp,mp:p.mp,max_mp:p.max_mp,attack:p.attack,frequency:p.frequency,speed:p.speed,armor:p.armor,resistance:p.resistance,gold:p.gold,xp:p.xp,items:p.items,slots:p.slots,s:p.s}]))`), null, 2), contentType: 'application/json' });
      // Guard the fixture contract: native recalculation must clamp initial pools.
      // Reading these values never repairs or changes a character's live stats.
      const nativeStats = await live.admin(`output=${JSON.stringify(names)}.map(name=>{const p=get_player(name);return {name,type:p.type,hp:p.hp,max_hp:p.max_hp,mp:p.mp,max_mp:p.max_mp,attack:p.attack,frequency:p.frequency,speed:p.speed,slots:p.slots}})`);
      for (const stats of nativeStats) {
        for (const key of ['hp','max_hp','mp','max_mp','attack','frequency','speed'])
          expect(Number.isFinite(stats[key]), `${loadout} ${stats.name} native ${key}`).toBe(true);
        expect(stats.hp).toBeLessThanOrEqual(stats.max_hp);
        expect(stats.mp).toBeLessThanOrEqual(stats.max_mp);
        expect(stats.max_hp).toBeGreaterThan(0);
        expect(stats.speed).toBeGreaterThan(0);
        const followStaff=loadout==='combat-follow-range'&&(stats.type==='priest'||stats.type==='mage');
        const weaponLevel=followStaff?(stats.type==='priest'?12:15):loadouts[loadout].weaponLevel;
        expect(stats.slots.mainhand.level, `${loadout} ${stats.name} native weapon`).toBe(weaponLevel);
        if(followStaff)expect(stats.slots.mainhand.name, `${loadout} ${stats.name} native staff`).toBe('staff');
        for (const [slot, equipped] of Object.entries(loadouts[loadout].armor))
          expect(stats.slots[slot], `${loadout} ${stats.name} native ${slot}`).toMatchObject(equipped);
      }
      if(extraFighter){
        const extra=await clients.E2EBankBoi.run('({name:character.name,ctype:character.ctype,connected:parent.socket?.connected,hp:character.hp,rip:character.rip})');
        expect(extra.name).toBe('E2EBankBoi');expect(extra.ctype).toBe(extraFighter);
        expect(extra.connected).toBe(true);expect(extra.hp).toBeGreaterThan(0);expect(extra.rip).toBe(false);
        await testInfo.attach('native-fourth-fighter-admission',{body:JSON.stringify(extra),contentType:'application/json'});
      }
      await testInfo.attach('live-build-manifest', { path: path.join(root, '.build/game/manifest.json'), contentType: 'application/json' });
      const nativeVersion=await clients[primaryName].run('parent.G.version');
      expect(Number.isSafeInteger(Number(nativeVersion))&&Number(nativeVersion)>0,'The primary native client must supply its actual game version').toBe(true);
      const catalogReadiness:Array<{at:number;version:unknown;choices:number}>=[];
      try{await expect.poll(async()=>{
        const state=await live!.state(true);
        if(catalogReadiness.length>=64)catalogReadiness.shift();
        catalogReadiness.push({at:Date.now(),version:state.gameVersion,choices:state.monsterChoices?.length||0});
        return String(state.gameVersion)===String(nativeVersion)&&Array.isArray(state.monsterChoices)&&state.monsterChoices.length>0;
      },{timeout:Math.max(1,nativeReadyDeadline-Date.now()),intervals:[1000],
        message:'Native bootstrap must publish the current game version and real monster catalog before starting the scenario'}).toBe(true);}
      finally{await testInfo.attach('native-bootstrap-catalog-readiness',{body:JSON.stringify({nativeVersion,deadline:nativeReadyDeadline,observations:catalogReadiness}),contentType:'application/json'});}
      if(initialConsoleHold)live.consoleDrainLease('native-initial-setup',Date.now()+600000,{loadMode:'now',phase:'holding'});
      await use(live);
    } finally {
      rmSync(path.join(directory,'hold-merchant-status'),{force:true});
      const attach = async (name: string, body: unknown) => testInfo.attach(name, { body: JSON.stringify(body, null, 2), contentType: 'application/json' });
      const diagnostic = async (work: Promise<unknown>) => {
        let timer: ReturnType<typeof setTimeout>;
        try { return await Promise.race([work, new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('Diagnostic timed out after 10 seconds')), 10_000);
        })]); }
        catch (error) { return { error: String(error) }; }
        finally { clearTimeout(timer!); }
      };
      const screenshots = new Set<Page>();
      const screenshot = async (page: Page, name: string) => {
        if (screenshots.has(page)) return;
        screenshots.add(page);
        try { await testInfo.attach(name, { body: await page.screenshot({ timeout: 10_000 }), contentType: 'image/png' }); }
        catch (error) { await attach(name + '-error', { error: String(error) }); }
      };
      try {
        if (live) {
          await attach('live-final-state', await live.state(true).catch(error => ({ error: String(error) })));
          await attach('live-server-final', await live.admin(`output=Object.fromEntries(Object.values(players).filter(p=>${JSON.stringify(names)}.includes(p.name)).map(p=>[p.name,{name:p.name,map:p.map,x:p.x,y:p.y,hp:p.hp,mp:p.mp,gold:p.gold,xp:p.xp,items:p.items,slots:p.slots,s:p.s}]))`).catch(error => ({ error: String(error) })));
        }
        for (const [name, client] of Object.entries(clients)) {
          await attach(name + '-native-disconnects', client.disconnects());
          await attach(name + '-native-events', await diagnostic(client.events()));
          await attach(name + '-character', await diagnostic(client.snapshot()));
          await attach(name + '-errors', client.errors);
          await screenshot(client.page, 'native-game-group');
        }
        for (const [index, page] of context.pages().entries()) {
          if (Object.values(clients).some(client => client.page === page)) continue;
          await screenshot(page, `startup-page-${index}`);
          await attach(`startup-page-${index}-location`, { url: page.url() });
        }
        await attach('live-action-ledger', exchanges);
        const visitorStatus = path.join(directory,'home-visitor-status.jsonl');
        if(existsSync(visitorStatus)) await testInfo.attach('home-visitor-status',{path:visitorStatus,contentType:'application/x-ndjson'});
        await attach('live-blocked-external-requests', blocked);
      } finally {
        try {
          const closed = await diagnostic(context.close());
          if (closed) await attach('native-context-close-diagnostic', closed);
          for (const [index, page] of [...nativePages].entries()) {
            const video = page.video();
            if (!video) continue;
            const result = await diagnostic((async () => {
              await testInfo.attach(`native-game-video-${index}`, { path: await video.path(), contentType: 'video/webm' });
            })());
            if (result) await attach(`native-game-video-${index}-diagnostic`, result);
          }
        } finally {
          await diagnostic(network.close());
          server.closeAllConnections();
          await diagnostic(new Promise<void>(resolve => {
            if (server.listening) server.close(() => resolve());
            else resolve();
          }));
          try { if (coordinator) await stop(coordinator, true); }
          finally {
            for (const file of [log, dashboard.log, path.join(directory, 'state.jsonl')])
              if (existsSync(file)) await diagnostic(testInfo.attach(path.basename(file), { path: file, contentType: 'text/plain' }));
          }
        }
      }
    }
  }, { timeout: 300_000 }],
  // A baseURL -> live dependency delays Playwright's automatic artifact recorder until
  // after native contexts exist. Keep context options independent so its single
  // recorder captures native setup, game actions, and dashboard pages together.
  // Live specs navigate using live.url explicitly.
  baseURL: async ({}, use) => { await use(undefined); },
});
export { expect };
