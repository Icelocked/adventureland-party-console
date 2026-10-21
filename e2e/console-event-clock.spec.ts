import {test,expect} from './fixtures';
import {fetchFullState} from './state-route';

test.use({timezoneId:'America/New_York'});
for(const [date,local] of [['2026-10-22T05:00:00Z','1:00 AM EDT'],['2026-11-05T05:00:00Z','12:00 AM EST']]){
  test(`Event clock preserves realm midnight as ${local}`,async({page},info)=>{
    await page.route('**/party-api/state*',async route=>{
      const response=await fetchFullState(route),state=await response.json();
      await route.fulfill({response,json:{...state,eventSchedules:[{id:'horseman',name:'Headless Horseman',next:Date.parse(date),clockOffsetMs:750,realmOffsetHours:-5,confirmed:true}]}});
    });
    await page.goto('/');
    const card=page.locator('article').filter({has:page.getByRole('heading',{name:'W',exact:true})});
    await card.getByRole('button',{name:/^Events \(/}).click();
    await expect(page.getByText(`Headless Horseman — Thu, ${local}`,{exact:false})).toBeVisible();
    await expect(page.getByText('Realm: 00:00 (UTC−5)',{exact:true})).toBeVisible();
    await page.getByText('Realm: 00:00 (UTC−5)',{exact:true}).scrollIntoViewIfNeeded();
    await info.attach('event-clock-local-and-realm',{body:await page.screenshot({animations:'disabled'}),contentType:'image/png'});
  });
}
