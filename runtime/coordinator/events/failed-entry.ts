import type { EventAttendance } from './attendance-limits.ts';
import type { EventSession } from './observations.ts';
import type { EventRecovery, ReturnConvoy, ReturnStatus, Waypoints, CommandView } from './return-types.ts';

interface FailedEntryState {
  activeConvoy: ReturnConvoy | null;
  eventReturn: EventRecovery | null;
  eventAttendance?: EventAttendance;
  eventSessions: Record<string, Pick<EventSession,'event'> & Partial<EventSession>>;
  statuses: Readonly<Record<string, ReturnStatus | undefined>>;
  commands: Readonly<Record<string, CommandView | undefined>>;
}

function exhausted(c: ReturnConvoy | null): c is ReturnConvoy & {walkingEvent:string} {
  return !!c && c.phase==='failed' && c.retryExhausted===true &&
    c.purpose==='shared-walk' && c.walkingActivity==='event' && !!c.walkingEvent &&
    !c.nonPreemptible && !c.merchantInterruption && c.participants.length>0;
}
function fresh(s: ReturnStatus | undefined, now:number): s is ReturnStatus {
  return !!s && Number.isFinite(s.seenAt) && Number(s.seenAt)>=now-3000 && Number(s.seenAt)<=now+1000;
}
function occurrenceOwned(state:FailedEntryState,c:ReturnConvoy,event:string,name:string,s:ReturnStatus) {
  const entry=state.eventAttendance?.[name]?.[event], session=state.eventSessions[name];
  if(!entry || entry.ended || entry.realm!==s.server || c.routeServer && c.routeServer!==s.server)return false;
  return participates(session,event,name);
}
function participates(session:FailedEntryState['eventSessions'][string] | undefined,event:string,name:string) {
  return session?.event===event && session.participants?.includes(name)===true;
}
function sameRevision(saved:Waypoints[string] | undefined,current:Waypoints[string] | undefined,revision:number) {
  return saved?.revision===revision && current?.revision===revision;
}
function savedWaypoint(state:FailedEntryState,c:ReturnConvoy,name:string,current:Waypoints):Waypoints[string] | undefined {
  const saved=state.eventSessions[name]?.waypoints?.[name],parent=c.walkingParents?.[name];
  const command=state.commands[name];
  if(!parent || !sameRevision(saved,current[name],parent.revision) ||
    command && command.convoyId!==c.id)return undefined;
  return saved;
}
function captureOwned(state:FailedEntryState,c:ReturnConvoy & {walkingEvent:string},current:Waypoints,names:string[],now:number) {
  const waypoints:Waypoints={};
  for(const name of c.participants){
    const s=state.statuses[name],saved=savedWaypoint(state,c,name,current);
    if(!names.includes(name) || !fresh(s,now) || !saved || !occurrenceOwned(state,c,c.walkingEvent,name,s))return null;
    waypoints[name]=saved;
  }
  return waypoints;
}

/** Exhaustion ends this owned occurrence, rather than repeatedly readmitting it. */
export function recoverExhaustedEventEntry(state: FailedEntryState, ports: {
  now(): number; activeNames(): string[]; persist(): void;
  navigation: { capture(names: string[]): Waypoints };
}, begin: (event: string, session: {participants:string[];waypoints:Waypoints}, forced:boolean) => EventRecovery | null): void {
  const c=state.activeConvoy;
  if(state.eventReturn || !exhausted(c))return;
  const event=c.walkingEvent, now=ports.now(), current=ports.navigation.capture(c.participants);
  const waypoints=captureOwned(state,c,current,ports.activeNames(),now);
  if(!waypoints)return;
  // Forced begin preserves the captured checkpoint even though this occurrence
  // will no longer be eligible. Its normal exit owns defense, Town and walking.
  const recovery=begin(event,{participants:[...c.participants],waypoints},true);
  if(!recovery || recovery.event!==event)return;
  for(const name of c.participants) state.eventAttendance![name][event].ignored ||= 'travel failure';
  ports.persist();
}
