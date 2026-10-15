import {requestObject} from '../http/contracts.ts';
import {routeOwner,sharedRoute} from './shared-route-store.ts';
import type {SharedState,SharedConvoy,SharedStatus,SharedRoute,RouteWaypoint} from './shared-route-types.ts';
/** A historical native acknowledgement remains valid only under fresh exact ownership and position. */
export function terminalSettlementMatches(state:SharedState,c:SharedConvoy,name:string,step:number,destination:RouteWaypoint,now:number):boolean {
  const status=state.statuses[name],route=sharedRoute(c),command=state.commands[name];
  if(!status || !route || !command || !stoppedFresh(status,now))return false;
  const movement=requestObject(status.movement),receipt=requestObject(movement.terminalSettlement);
  return completedReceipt(movement,receipt) && terminalStep(route,receipt,step,destination) &&
    observedEndpoint(status,c,receipt,destination) && currentReport(status,c,command.id,command.navigationRevision,receipt) &&
    routeOwner(state,{character:name,...receipt},now);
}
function completedReceipt(movement:Record<string,unknown>,receipt:Record<string,unknown>):boolean {
  return movement.done===true && receipt.acknowledged===true && receipt.journeyId===movement.id && typeof movement.id==='string' && movement.id.length>0;
}
function terminalStep(route:SharedRoute,receipt:Record<string,unknown>,step:number,destination:RouteWaypoint):boolean {
  const geometry=requestObject(receipt.geometry),nativeDestination=requestObject(receipt.destination);
  const transitions=route.plot.filter(p=>p.town || p.transport || p.method==='leave');
  return geometry.version===route.geometry.version && geometry.fingerprint===route.geometry.fingerprint &&
    step===transitions.length-1 && receipt.step===step && sameStep(transitions[step],destination) && sameStep(nativeDestination,destination) && finalEndpoint(route,destination);
}
function observedEndpoint(status:SharedStatus,c:SharedConvoy,receipt:Record<string,unknown>,destination:RouteWaypoint):boolean {
  return typeof status.server==='string' && status.server.length>0 && (c.routeServer===undefined || status.server===c.routeServer) && receipt.server===status.server && samePosition(status,destination);
}
function currentReport(status:SharedStatus,c:SharedConvoy,commandId:number,revision:number,receipt:Record<string,unknown>):boolean {
  const r=status.convoyNavigation;
  return !!r && ['arrived','leg-arrived'].includes(r.phase) && r.routeVersion===c.routeVersion && r.id===c.id &&
    r.epoch===c.epoch && r.commandId===commandId && r.navigationRevision===revision && r.runtimeId===receipt.runtimeId;
}
function stoppedFresh(s:SharedStatus,now:number):boolean {
  return s.seenAt>=now-3000 && s.seenAt<=now+500 && !s.rip && Number(s.hp)>0 && !s.moving && !s.transporting;
}
function instance(a:Record<string,unknown>|RouteWaypoint):string|undefined {
  const value=a.in??a.map;return typeof value==='string' || typeof value==='number' ? String(value) : undefined;
}
function samePosition(a:Record<string,unknown>|RouteWaypoint,b:RouteWaypoint):boolean {
  return a.map===b.map && instance(a)===instance(b) && Number.isFinite(a.x) && Number.isFinite(a.y) &&
    Math.hypot(Number(a.x)-b.x,Number(a.y)-b.y)<=1;
}
function sameStep(a:Record<string,unknown>|RouteWaypoint|undefined,b:RouteWaypoint):boolean {
  return !!a && a.map===b.map && instance(a)===instance(b) && a.x===b.x && a.y===b.y &&
    !!a.town===!!b.town && !!a.transport===!!b.transport && a.s===b.s && a.method===b.method;
}

function finalEndpoint(route:SharedRoute,destination:RouteWaypoint):boolean {
  return sameStep(route.plot.at(-1),destination) && samePosition(route.destination,destination);
}
