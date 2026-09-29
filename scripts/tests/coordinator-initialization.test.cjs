const test=require('node:test'),assert=require('node:assert/strict');
const {initializeCoordinatorState}=require('../../runtime/coordinator/initialization.ts');
const {stateKeys}=require('../../runtime/coordinator/persistence/snapshots.ts');
test('portable merchant defaults preserve saved selection and explicit absence without writing storage', () => {
  for (const [savedMerchant, merchantDefault, expected] of [
    [undefined, 'AccountMerchant', 'AccountMerchant'],
    ['SavedMerchant', 'AccountMerchant', 'SavedMerchant'],
    [undefined, null, null], ['SavedMerchant', null, 'SavedMerchant'],
    ['', null, null], [undefined, undefined, 'GoldMajesty'],
  ]) {
    const storage = {get: key => key === stateKeys.settings ? JSON.stringify({merchantCharacter: savedMerchant}) : undefined,
      set: () => assert.fail('default selection must not rewrite saved settings')};
    const result = initializeCoordinatorState(storage, {}, 'SR_USII', {
      merchantDefault, now: () => 100, loadBankVaultDefinitions: () => [], warn: () => assert.fail('valid defaults warned'),
    });
    assert.equal(result.party.merchantCharacter, expected);
    assert.equal(result.persistedSettings.merchantCharacter, savedMerchant);
  }
});

test('malformed roster JSON falls back independently while valid settings survive',()=>{
 const warnings=[];
 const result=initializeCoordinatorState({get:key=>key===stateKeys.roster?'{broken':key===stateKeys.settings?'{"merchantCharacter":"M"}':undefined,set:()=>{}},
  {P:{enabled:true},Off:{enabled:false},M:{enabled:true}},'SR_USII',{
   now:()=>100,loadBankVaultDefinitions:()=>[],warn:(details,message)=>warnings.push({details,message}),
  });
 assert.deepEqual(result.party.headlessSlots,['P','M',null,null]);assert.equal(result.party.merchantCharacter,'M');
 assert.equal(warnings.length,1);assert.equal(warnings[0].message,'Ignoring invalid persisted Party Console roster state');
 assert.ok(warnings[0].details.error instanceof SyntaxError);
});
