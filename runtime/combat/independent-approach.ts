import type {Member} from './grouped.ts';
type Status=NonNullable<Member['status']>;
function available(member:Member):member is Member & {status:Status} {
  const s=member.status;
  return !!s && !member.cancelled && !s.rip && s.hp>0 && !s.activeEvent && !s.joinedEvent && !s.mapEvent;
}
function samePlace(s:Status,anchor:Status):boolean {
  return s.server===anchor.server && s.map===anchor.map && s.in===anchor.in;
}
function currentCapability(s:Status,now:number):boolean {
  return now-s.seenAt<=3000 && s.seenAt<=now+500 && s.groupedCombat?.protocol===4 && s.groupedCombat.independentApproach===true;
}
/** Capability is ownership support, never proof of physical attack arrival. */
export function independentApproach(members:Member[],now:number):boolean {
  const anchor=members[0]?.status;
  return !!anchor && members.every(member=>available(member) && samePlace(member.status,anchor) && currentCapability(member.status,now));
}
