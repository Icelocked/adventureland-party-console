import type { MovementHost } from './movement-host.ts';
// Native 15555 accepts correction before CODE listeners, but leaves the old
// origin velocity when speed is unchanged. Stop only the accepted owned walk;
// the normal executor must validate its remaining connector on the next tick.
export function observeMovementCorrections(host: MovementHost, walking: () => boolean, pause: () => void, now: () => number) {
  const socket=host.parent.socket;
  const records: {at:number;map:string;in?:string|number;x:number;y:number;stopRequested:boolean}[]=[];
  function accepted(value: unknown): boolean {
    if(!value || typeof value!=='object')return false;
    const p=value as {x?:unknown;y?:unknown},c=host.character;
    return typeof p.x==='number' && Number.isFinite(p.x) && typeof p.y==='number' && Number.isFinite(p.y) &&
      c.real_x===p.x && c.real_y===p.y;
  }
  function corrected(value: unknown) {
    try {
      if(!accepted(value) || !walking() || host.is_transporting(host.character) || !host.can_walk(host.character))return;
      const c=host.character,record={at:now(),map:c.map,in:c.in,x:c.real_x,y:c.real_y,stopRequested:false};
      records.push(record);if(records.length>4)records.shift();
      pause();record.stopRequested=true;
    } catch { /* A retired runner or failed native stop must not interrupt native socket delivery. */ }
  }
  // Both APIs must exist so replacing CODE can always remove only our listener.
  if(socket.on && (socket.off || socket.removeListener))socket.on('correction',corrected);
  function dispose() {
    if(socket.off)socket.off('correction',corrected);
    else socket.removeListener?.('correction',corrected);
  }
  return {report:()=>records.map(record=>({...record})),dispose};
}
