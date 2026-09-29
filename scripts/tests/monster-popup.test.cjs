const test = require('node:test');
const assert = require('node:assert/strict');

test('manual monster navigation is an atomic auto-mode convoy override', () => {
  const {createMonsterSelection}=require('../../runtime/coordinator/navigation/monster-selection.ts');
  const party={leader:'L',followers:{F:true},monsterFocusByCharacter:{F:['bat']},scatterEpoch:1,commands:{L:{type:'party-monster-travel'}}};
  let cleared=0,authorized;
  const service=createMonsterSelection(party,{release(){},clearHunt:()=>cleared++,members:()=>['L','F'],authorize:(...args)=>authorized=args,
    start:()=>true,stopPhoenix(){},persist(){}});
  const location={map:'main',x:1,y:2};service.select('goo',location);
  assert.equal(party.farmingPolicy,'auto');assert.deepEqual(party.monsterFocus,['goo']);assert.equal(cleared,1);
  assert.equal(party.commands.L.manualMonsterOverride,true);assert.deepEqual(authorized,[['L','F'],location,true]);
});
