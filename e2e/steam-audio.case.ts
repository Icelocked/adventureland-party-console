import { test, expect } from './fixtures';
import { build } from 'esbuild';

// Failure modes: initial native flags ignored; music and effects cross-toggle;
// native persistence bypassed; external settings go stale; roster operations
// disable audio; minimize/restore loses state; disposing leaves controls alive.
// Native audio functions are the declared boundary; real switcher DOM executes.
test('Steam Characters bar independently toggles native sounds and music', async ({page},info)=>{
  const bundle=await build({entryPoints:['runtime/steam/switcher.ts'],bundle:true,write:false,platform:'browser',format:'iife',globalName:'Switcher'});
  await page.route('http://audio.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body style="background:#163127"></body>'}));
  await page.goto('http://audio.test/');await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.evaluate(()=>{
    const host=window as any;host.sound_sfx='1';host.sound_music='';host.audioCalls=[];
    for(const [name,flag,value] of [['sfx_on','sound_sfx','1'],['sfx_off','sound_sfx',''],['sound_on','sound_music','1'],['sound_off','sound_music','']]){
      host[name]=()=>{host[flag]=value;localStorage.setItem(flag,value);host.audioCalls.push(name);};
    }
    host.switcher=host.Switcher.createSwitcher(window,async()=>{throw Error('Audio must not request a character operation');});
    host.switcher.render({members:[],realm:'SR_USI',operation:{phase:'release'}});
  });
  const sounds=page.getByRole('button',{name:'mute game sounds',exact:true});
  const music=page.getByRole('button',{name:'mute game music',exact:true});
  await expect(sounds).toHaveAttribute('aria-pressed','false');await expect(music).toHaveAttribute('aria-pressed','true');
  await expect(sounds.locator('svg')).toBeVisible();await expect(music.locator('svg')).toBeVisible();
  await sounds.click();await expect(sounds).toHaveAttribute('aria-pressed','true');
  await music.click();await expect(music).toHaveAttribute('aria-pressed','false');
  await sounds.click();await music.click();
  expect(await page.evaluate(()=>(window as any).audioCalls)).toEqual(['sfx_off','sound_on','sfx_on','sound_off']);
  await page.evaluate(()=>{(window as any).sound_sfx='';(window as any).sound_music='1';});
  await expect(sounds).toHaveAttribute('aria-pressed','true');await expect(music).toHaveAttribute('aria-pressed','false');
  await page.getByRole('button',{name:'Minimize Steam character controls',exact:true}).click();
  await expect(sounds).toHaveCount(0);
  await page.getByRole('button',{name:'Restore Steam character controls',exact:true}).click();
  await expect(sounds).toHaveAttribute('aria-pressed','true');await expect(music).toHaveAttribute('aria-pressed','false');
  await info.attach('steam-audio-controls',{body:await page.screenshot(),contentType:'image/png'});
  await info.attach('steam-audio-ledger',{body:JSON.stringify(await page.evaluate(()=>({calls:(window as any).audioCalls,sfx:localStorage.getItem('sound_sfx'),music:localStorage.getItem('sound_music')}))),contentType:'application/json'});
  await page.evaluate(()=>(window as any).switcher.dispose());await expect(page.locator('#party-console-switcher')).toHaveCount(0);
});
