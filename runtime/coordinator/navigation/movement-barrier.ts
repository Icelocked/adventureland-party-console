import {terminalSettlementMatches} from './terminal-settlement.ts';
import {classifyTravelDefense} from './travel-defense.ts';
import { requestObject } from '../http/contracts.ts';
import { routeOwner, routeIdentityOwned, sharedRoute } from './shared-route-store.ts';
import { isPoint, type Point } from '../../navigation/contracts.ts';
import type { SharedState, SharedConvoy, SharedStatus } from './shared-route-types.ts';
interface ReadyAcknowledgement { at:number; owner:Record<string,unknown>; position:Pick<SharedStatus,'map'|'in'|'x'|'y'> }
interface Barrier { key: string; ready: Map<string, ReadyAcknowledgement>; completed: Set<string>; releasedAt?: number }
const barriers = new WeakMap<SharedConvoy, Map<string, Barrier>>();
function getBarrier(c: SharedConvoy, key: string): Barrier {
  let store = barriers.get(c); if (!store) { store = new Map(); barriers.set(c, store); }
  let barrier = store.get(key);
  if (!barrier) { barrier = {key, ready: new Map(), completed: new Set()}; store.set(key, barrier); }
  return barrier;
}
function validStep(body: Record<string, unknown>): boolean {
  return Number.isInteger(body.step) && Number(body.step) >= 0 && Number(body.step) <= 1000 && isPoint(body.destination);
}
function liveOwner(state: SharedState, body: Record<string, unknown>, now: number): boolean {
  const c = state.activeConvoy;
  return !!c && routeOwner(state, body, now) && (c.phase === 'travel' || c.phase === 'scheduled' && now >= Number(c.departAt));
}
/** Before/after transition barriers are route-owned and ephemeral, never restored after restart. */
export function movementBarrier(state: SharedState, input: unknown, now: number): { ready?: boolean; error?: string; code?: string; waiting?: string } {
  const body = requestObject(input), c = state.activeConvoy;
  if (!c || !liveOwner(state, body, now)) return unavailable(state,body,now);
  if (!validStep(body)) return { error: 'Invalid transition identity' };
  const p = body.destination as Point;
  if (!publishedStep(c,body)) return {error:'Transition does not match published itinerary',code:'invalid-step'};
  const key = `${c.epoch}:${c.routeVersion}:${Number(body.step)}:${p.map}:${p.x}:${p.y}`;
  const barrier = getBarrier(c, key);
  const name = String(body.character), members = c.participants.filter(n => !c.completed.includes(n));
  if(townBlocked(state,c,barrier,body,now))return {ready:false,waiting:'fresh party observations without attackers'};
  acknowledge(state,barrier,body,name,now);
  if (body.completed === true) return completedBarrier(state,c,barrier,members,body,now);
  if (!barrier.releasedAt && members.every(n => readyOwner(state,barrier.ready.get(n),now))) barrier.releasedAt = now;
  return { ready: !!barrier.releasedAt };
}
function stopped(status:SharedStatus|undefined):status is SharedStatus {
  return !!status && !status.rip && status.hp!==0 && !status.moving && !status.transporting &&
    typeof status.map==='string' && Number.isFinite(status.x) && Number.isFinite(status.y);
}
function readyOwner(state:SharedState,ack:ReadyAcknowledgement|undefined,now:number):boolean {
  if(!ack || ack.at<now-3000 || !routeOwner(state,ack.owner,now))return false;
  const status=state.statuses[String(ack.owner.character)],position=ack.position;
  return stopped(status) && status.seenAt<=now+500 && status.map===position.map &&
    String(status.in??status.map)===String(position.in??position.map) &&
    Math.hypot(status.x-position.x,status.y-position.y)<=1;
}
function acknowledge(state:SharedState,barrier: Barrier, body: Record<string,unknown>, name: string, now: number): void {
  if(body.completed===true)barrier.completed.add(name);
  else if(body.ready===true && stopped(state.statuses[name])) {
    const status=state.statuses[name]!;
    // Readiness shares the existing fresh-owner window, and is valid only at
    // the same stopped native position. It never renews a client's walking lease.
    barrier.ready.set(name,{at:now,owner:{...body},position:{map:status.map,in:status.in,x:status.x,y:status.y}});
  }
  else if(!barrier.releasedAt)barrier.ready.delete(name);
}
function unavailable(state: SharedState, body: Record<string,unknown>, now: number) {
  const c=state.activeConvoy;
  if(routeIdentityOwned(state,body) && c?.phase==='travel')return {ready:false,waiting:'fresh observations'};
  if(routeIdentityOwned(state,body) && c?.phase==='scheduled' && now<Number(c.departAt))
    return {error:'Stale movement barrier owner',code:'before-departure'};
  return {error:'Stale movement barrier owner',code:'superseded'};
}
function publishedStep(c: SharedConvoy, body: Record<string,unknown>): boolean {
  if(!c.continuousReturn)return true;
  const step=sharedRoute(c)?.plot.filter(p=>p.town || p.transport || p.method==='leave')[Number(body.step)];
  const p=body.destination as Point & {town?:boolean;transport?:boolean;s?:number;method?:string};
  return !!step && step.map===p.map && step.x===p.x && step.y===p.y &&
    !!step.town===!!p.town && !!step.transport===!!p.transport && step.s===p.s && step.method===p.method;
}

function townBlocked(state:SharedState,c:SharedConvoy,barrier:Barrier,body:Record<string,unknown>,now:number):boolean {
  return !barrier.releasedAt && !!c.continuousReturn && !!(body.destination as {town?:boolean}).town &&
    classifyTravelDefense(state,c.participants,now).state!=='clear';
}

function completedBarrier(state:SharedState,c:SharedConvoy,barrier:Barrier,members:string[],body:Record<string,unknown>,now:number) {
  if(barrier.releasedAt)for(const peer of members)if(terminalSettlementMatches(state,c,peer,Number(body.step),body.destination as Point,now))barrier.completed.add(peer);
  return {ready:members.every(n=>barrier.completed.has(n))};
}
