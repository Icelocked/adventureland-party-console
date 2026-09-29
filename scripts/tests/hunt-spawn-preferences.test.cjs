const test = require('node:test'), assert = require('node:assert/strict');
const {coordinatorHuntDestination} = require('../../runtime/coordinator/hunt/controls.ts');
const {huntSpawnKey} = require('../../runtime/coordinator/hunt/spawn-preferences.ts');
const {createHuntSettingsRoute} = require('../../runtime/coordinator/http/hunt-settings.ts');
const {initialFarmingState} = require('../../runtime/coordinator/navigation/initial-farming.ts');
const {zones} = require('../../dashboard/lib/farming-zones.ts');
const near = {map:'main',x:10,y:10}, preferred = {map:'arena',x:384,y:-420};
const catalog = [{id:'cgoo',locations:[near,preferred]}];
function response(){return {code:200,status(n){this.code=n;return this},json(v){this.value=v;return v}};}

test('manual, unavailable and cleared Hunt preferences use normal ranking', () => {
  const state = {leader:'W',statuses:{W:near},monsterChoices:catalog};
  const route = createHuntSettingsRoute(state,{persist(){},now:()=>1});
  route({body:{preferredSpawns:{cgoo:huntSpawnKey(preferred)}}},response());
  const restored = {...state,...initialFarmingState(JSON.parse(JSON.stringify(state)),()=>1)};
  assert.equal(coordinatorHuntDestination(restored,'cgoo',zones,false).map,'main');
  assert.equal(coordinatorHuntDestination(restored,'cgoo',()=>[near]),near,'excluded preference does not defeat recovery');
  route({body:{preferredSpawns:{cgoo:''}}},response());
  assert.equal(coordinatorHuntDestination(state,'cgoo',zones).map,'main');
});
