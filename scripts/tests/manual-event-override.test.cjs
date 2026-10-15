const test=require('node:test'),assert=require('node:assert/strict');
const {skipManualEventOccurrences,observeEventAttendance,eventInstanceAllowed,manualEventOccurrenceSkipped}=require('../../runtime/coordinator/events/attendance-limits.ts');
function fixture(){return {leader:'W',followers:{P:true},eventSelectionsByCharacter:{W:['icegolem']},
  statuses:{W:{seenAt:100000,server:'USII'}},eventAttendance:{},
  eventSessions:{W:{event:'icegolem',id:null,authorizedRealm:'USII',authorizedAt:100000,lastLiveAt:100000,participants:['W'],participationRecorded:true}}};}
test('manual travel records an already authorized prejoin before its first attendance entry',()=>{
  const s=fixture();skipManualEventOccurrences(s,['W'],100000);
  assert.equal(s.eventAttendance.W.icegolem.ignored,'manual travel');
  assert.equal(s.eventAttendance.W.icegolem.attending,false);
  assert.equal(eventInstanceAllowed(s,'W','icegolem'),false);
  assert.equal(eventInstanceAllowed(s,'P','icegolem'),true);
  observeEventAttendance(s,{name:'W',server:'USII',serverLiveEvents:[{name:'icegolem',id:'native-1'}]},100100);
  assert.equal(s.eventAttendance.W.icegolem.id,'native-1');
  assert.equal(eventInstanceAllowed(s,'W','icegolem'),false);
  observeEventAttendance(s,{name:'W',server:'USII',serverLiveEvents:[]},111000);
  observeEventAttendance(s,{name:'W',server:'USII',serverLiveEvents:[{name:'icegolem',id:'native-2'}]},112000);
  assert.equal(eventInstanceAllowed(s,'W','icegolem'),true);
});
for(const [label,amend]of [
 ['stale status',s=>s.statuses.W.seenAt=1],
 ['missing realm',s=>delete s.statuses.W.server],
 ['unrecorded session',s=>delete s.eventSessions.W.participationRecorded],
 ['unowned session',s=>s.eventSessions.W.participants=['P']],
 ['missing session',s=>delete s.eventSessions.W],
 ['wrong authorization realm',s=>s.eventSessions.W.authorizedRealm='EUI'],
 ['missing authorization realm',s=>delete s.eventSessions.W.authorizedRealm],
 ['stale authorization',s=>s.eventSessions.W.authorizedAt=1],
 ['disconnected feed',s=>s.statuses.W.eventFeedConnected=false],
 ['stale clock',s=>s.statuses.W.eventClockStale=true],
])test('manual travel does not manufacture exclusion from '+label,()=>{
 const s=fixture();amend(s);skipManualEventOccurrences(s,['W'],100000);
 assert.deepEqual(s.eventAttendance,{});
});

for(const reason of ['death limit','time limit'])test('manual route ownership preserves '+reason,()=>{
 const s=fixture();observeEventAttendance(s,{name:'W',server:'USII',joinedEvent:'icegolem',serverLiveEvents:[{name:'icegolem',id:'native-1'}]},100000);
 s.eventAttendance.W.icegolem.ignored=reason;
 skipManualEventOccurrences(s,['W'],100000);
 assert.equal(s.eventAttendance.W.icegolem.ignored,reason);
 assert.equal(manualEventOccurrenceSkipped(s,'W','icegolem'),true);
});
