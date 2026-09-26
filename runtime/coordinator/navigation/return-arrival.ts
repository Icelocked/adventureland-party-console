import { recordConvoyHistory } from './convoy-history.ts';
import { heldReturnArrivalReady, sharedArrivalReady } from './shared-route-store.ts';
import type { SharedConvoy, SharedState } from './shared-route-types.ts';
import { rememberCompletion } from './completion-receipts.ts';

/** Recover a missing HTTP completion using the same owned arrival reports. */
export function reconcileReturnArrival(state: SharedState, c: SharedConvoy, now: number): boolean {
  const held = failedHuntReturn(state, c);
  if (!held && !recoverableArrival(c)) return false;
  const ready = held ? heldReturnArrivalReady(state, c, now) : sharedArrivalReady(state, now);
  if (!ready) { delete c.arrivalReadySince; return false; }
  c.arrivalReadySince ??= now;
  // Give the normal completion requests time to settle before retiring their commands.
  if (now - c.arrivalReadySince < 3000) return false;
  retireCommands(state, c);
  c.completed = [...c.participants];
  recordConvoyHistory(state, c, 'completed', now, { reason: held
    ? 'Verified party arrival at Daisy released failed return hold'
    : 'Verified Hunt arrival recovered missing completion acknowledgment' });
  state.activeConvoy = null;
  return true;
}

function retireCommands(state: SharedState, c: SharedConvoy): void {
  for (const name of c.participants) {
    if (!c.completed.includes(name)) {
      const command = state.commands[name]!;
      rememberCompletion(state, name, { convoyId: c.id, epoch: c.epoch, commandId: command.id,
        runtimeId: c.runtimes?.[name], navigationRevision: command.navigationRevision, routeVersion: c.routeVersion });
      delete state.commands[name];
    }
  }
}

function failedHuntReturn(state: SharedState, c: SharedConvoy): boolean {
  return c.phase === 'failed' && c.purpose === 'monster-hunt' && !!c.continuousReturn &&
    !!c.returnRouting && c.failureCode === 'route-failed' &&
    state.monsterHunt?.stage === 'returning' && state.monsterHunt.convoyId === c.id;
}

function recoverableArrival(c: SharedConvoy): boolean {
  // Legacy per-leg returns still require their transition barrier. Pickup and
  // outbound shared routes use the same verified final-arrival recovery.
  return c.purpose === 'monster-hunt' && c.phase === 'travel' &&
    (!c.returnRouting || !!c.continuousReturn);
}
