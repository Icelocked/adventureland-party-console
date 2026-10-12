import type {BrowserContext} from '@playwright/test';
import type {LiveClientOptions} from './live-game-client';

const installed=new WeakSet<BrowserContext>();

/** Opt-in diagnostic uses the official bot startup flag without changing game code. */
export async function installCompanionGraphicsDiagnostic(context:BrowserContext,
 options:Pick<LiveClientOptions,'webUrl'|'name'|'region'|'server'>,enabled:boolean):Promise<void>{
 if(!enabled || installed.has(context))return;
 const origin=new URL(options.webUrl).origin;
 await context.route(url=>{
  const path=url.pathname.split('/').filter(Boolean);
  return url.origin===origin && path.length===5 && path[0]==='character' && path[2]==='in' &&
   decodeURIComponent(path[1]).toLowerCase()!==options.name.toLowerCase() && path[3]===options.region && path[4]===options.server &&
   url.searchParams.get('no_html')==='true' && url.searchParams.get('is_bot')==='1';
 },async route=>{
  if(route.request().method()!=='GET'){await route.continue();return;}
  const url=new URL(route.request().url());url.searchParams.set('no_graphics','true');
  await route.continue({url:url.href});
 });
 installed.add(context);
}
