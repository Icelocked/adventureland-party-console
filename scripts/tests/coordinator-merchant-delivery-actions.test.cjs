const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorMerchantDeliveryActions}=require('../../runtime/coordinator/http/merchant-delivery-actions.ts');
const {fixture}=require('./helpers/coordinator-completion.cjs');


function compose(f,extra={}) {
 return createCoordinatorMerchantDeliveryActions(f.state,{...f.ports,
  inbox:()=>({complete:f.ports.mailComplete}),fetchMarket:f.ports.fetchAuth,
  bankboi:async()=>{},identity:JSON.stringify,...extra});
}

test('authentication confirmation encodes current credentials when the delayed callback runs',async()=>{
 const f=fixture({job:{reason:'ALData authentication'}}),paths=[];
 const service=compose(f,{fetchMarket:async path=>{paths.push(path);return {auth:'CORRECT'};}});
 service.complete({body:{jobId:'job',success:true}},f.response);
 assert.deepEqual(paths,[]);assert.ok(f.calls.some(call=>call[0]==='timer'&&call[1]===65000));
 f.state.merchantCharacter='M /'; f.state.aldata.key='key/?#';
 f.timers[0]();await Promise.resolve();await Promise.resolve();
 assert.deepEqual(paths,['/auth/M%20%2F/key%2F%3F%23']);
 assert.equal(f.state.aldata.auth,'CORRECT');assert.ok(f.calls.some(call=>call[0]==='publishALData'));
});
