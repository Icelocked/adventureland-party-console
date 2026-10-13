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

export interface IndependentReady {selection:string;target:string;at:number;ready:boolean;confirmation?:string}
export interface IndependentConfirmation {id:string;selection:string;target:string;startedAt:number;expiresAt:number}
/** Snapshot only actual actor reports; capability and target ACK remain separate. */
export function independentReadiness(members:Member[]):Record<string,IndependentReady> {
  return Object.fromEntries(members.flatMap(member=>{const r=member.status?.groupedCombat?.independentReady;
    return r?[[member.name,{selection:r.selection,target:r.target,at:r.at,ready:r.ready,confirmation:r.confirmation}]]:[];}));
}
export function allIndependentReady(members:Member[],selection:string|null,target:string,now:number):boolean {
  return !!selection && members.every(member=>{const r=member.status?.groupedCombat?.independentReady;
    return !!r && r.ready===true && r.selection===selection && r.target===target && now-r.at<=3000 && r.at<=now+500;});
}

interface ConfirmationState {independentConfirmation?:IndependentConfirmation;independentConfirmationRevision?:number}
function currentRound(previous:ConfirmationState|undefined,selection:string,target:string,now:number):IndependentConfirmation|undefined {
  const round=previous?.independentConfirmation;
  return round && round.selection===selection && round.target===target && now>=round.startedAt && now<round.expiresAt?round:undefined;
}
function staleEcho(members:Member[],round:IndependentConfirmation,now:number):boolean {
  return members.some(member=>{const r=member.status?.groupedCombat?.independentReady;
    return r?.confirmation===round.id && now-r.at>1000;});
}
function confirmed(member:Member,round:IndependentConfirmation,now:number):boolean {
  const r=member.status?.groupedCombat?.independentReady;
  return !!r && r.ready===true && r.selection===round.selection && r.target===round.target &&
    r.confirmation===round.id && r.at>=round.startedAt && now-r.at<=1000 && r.at<=now+500;
}
/** Issue and settle in the same status evaluation; no timing hold substitutes for checks. */
export function confirmIndependentApproach(previous:ConfirmationState|undefined,members:Member[],selection:string|null,target:string,now:number) {
  let revision=previous?.independentConfirmationRevision||0;
  if(!selection || !allIndependentReady(members,selection,target,now))return {revision,ready:false};
  let confirmation=currentRound(previous,selection,target,now);
  if(confirmation && staleEcho(members,confirmation,now))confirmation=undefined;
  if(!confirmation){revision++;confirmation={id:JSON.stringify([selection,revision,now]),selection,target,startedAt:now,expiresAt:now+3000};
    return {revision,confirmation,ready:false};}
  return {revision,confirmation,ready:members.every(member=>confirmed(member,confirmation!,now))};
}
