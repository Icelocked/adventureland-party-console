import {test,expect} from './fixtures';

// Failure inventory: candidate shown instead of deployed build; stale hash after
// activation; added flow height shifting header/content; overflow on small screens.
test('deployed artifact hash updates below the version without moving the header',async({page},info)=>{
  let active:string|undefined;
  const first='123456789abc'+'0'.repeat(52),next='abcdef987654'+'1'.repeat(52);
  await page.route('**/console-build',route=>route.fulfill({json:{active,latest:'f'.repeat(64),builds:[],pendingBuildCount:0,building:false}}));
  await page.goto('/');await expect(page.getByRole('heading',{name:'Party Console',exact:true})).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);
  const observations=[];
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});active=undefined;
    const label=page.locator('[data-console-artifact]');
    await expect(label).toHaveCount(0);
    const bounds=()=>page.locator('header').evaluate(el=>({header:el.getBoundingClientRect().toJSON(),contentTop:el.nextElementSibling?.getBoundingClientRect().top}));
    const before=await bounds();active=first;
    await expect(label).toHaveText('Artifact 123456789abc');await expect(label).toHaveAttribute('title',first);
    expect(await bounds()).toEqual(before);
    const position=await label.boundingBox(),version=await label.evaluate(el=>el.previousElementSibling!.getBoundingClientRect().toJSON());
    expect(position!.y).toBeGreaterThanOrEqual(version!.y+version!.height);
    expect(position!.x+position!.width).toBeLessThanOrEqual(width);
    active=next;await expect(label).toHaveText('Artifact abcdef987654');expect(await bounds()).toEqual(before);
    observations.push({width,before,after:await bounds(),position});
    await info.attach(`artifact-header-${width}`,{body:await page.screenshot(),contentType:'image/png'});
  }
  await info.attach('artifact-header-layout',{body:JSON.stringify(observations),contentType:'application/json'});
});
