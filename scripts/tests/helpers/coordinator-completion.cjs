const {failNpcSales} = require('../../../runtime/coordinator/merchant/npc-sales.ts');
function fixture(scenario) {
  const state = {merchantCharacter:'M', merchantCurrent:{id:'job',target:'F',reason:'service'},
    merchantQueue:[], commands:{M:{type:'merchant-service'},F:{type:'merchant-handoff'}},
    nextCommandId:10, standSearch:null, merchantCargo:null, mluckCastAt:{},
    marked:{F:[{name:'leather'},{name:'leather'}],M:[{name:'ore'}]},
    upgrades:{F:[{name:'sword'}]}, statScrolls:{F:[{name:'strscroll'}]}, compounds:{F:[{name:'ring'}]},
    autoCompounds:{F:[{name:'ring'},{name:'amulet'}]}, withdrawals:{F:[{name:'ring'}],M:[{name:'ore'}]},
    purchases:{F:[{name:'potion'}]}, merchantMarked:{F:[{name:'cape'}]},
    merchantDeliveries:{F:[{item:{name:'sword',level:8},equipOnDelivery:true}]},
    npcSaleMarks:[], merchantJobBlocks:{}, bankSnapshot:{gold:500}, statuses:{M:{gold:100,items:[]}},
    aldata:{auth:'NO',authCheckedAt:0,key:'key'}};
  Object.assign(state, structuredClone(scenario.state || {}));
  Object.assign(state.merchantCurrent, structuredClone(scenario.job || {}));
  const calls=[], timers=[];
  const record=name=>(...args)=>{calls.push([name,...args]);};
  const ports={now:()=>100000,nextCommand:()=>state.nextCommandId++,mailComplete:record('mail'),
    fulfill:record('bid'),clearUpgrades:record('upgrades'),clearIncoming:record('incoming'),log:record('log'),
    capacitySignature:()=> 'capacity',persistALData:record('persistALData'),
    fetchAuth:async()=>({auth:'CORRECT'}),publishALData:record('publishALData'),
    schedule:(callback,delay)=>{calls.push(['timer',delay]);timers.push(callback);},stamp:job=>job,
    queue:record('queue'),ensureHome:record('home'),persistBank:record('bank'),persist:record('persist'),
    dispatch:record('dispatch'),pontyMatches:()=>{calls.push(['ponty']);return false;},aldataMatches:record('aldata')};
  const context={party:state,Date:{now:ports.now},mailInbox:{complete:ports.mailComplete},
    fulfillStandBid:ports.fulfill,clearResolvedUpgradeMarks:ports.clearUpgrades,
    clearIncomingCompoundReservation:ports.clearIncoming,merchantLog:ports.log,
    merchantCapacitySignature:ports.capacitySignature,persistALData:ports.persistALData,
    aldataFetch:ports.fetchAuth,scheduleALDataPublish:ports.publishALData,setTimeout:ports.schedule,
    stampMerchantJob:ports.stamp,queueMerchant:ports.queue,ensureMerchantHome:ports.ensureHome,
    persistBankState:ports.persistBank,persistSettings:ports.persist,dispatchMerchant:ports.dispatch,
    queuePontyMatches:ports.pontyMatches,queueALDataMatches:ports.aldataMatches,coordinatorPolicies:{failNpcSales}};
  const response={code:200,status(code){this.code=code;return this;},json(body){this.body=body;}};
  return {state,ports,context,response,calls,timers};
}
module.exports={fixture};
