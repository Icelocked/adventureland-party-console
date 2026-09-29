export interface MerchantMovementState {
  merchantCharacter?: string | null;
  activeConvoy?: { nonPreemptible?: boolean; participants: string[] } | null;
}

/** Failed Hunt returns retain ownership until explicitly retried or cancelled. */
export function protectedMerchantRecipient(state: MerchantMovementState, name: string): boolean {
  return !!state.activeConvoy?.nonPreemptible && state.activeConvoy.participants.includes(name);
}

export function merchantMovementBlocked(state: MerchantMovementState, job: {
  target?: string | null; reason: string; order?: unknown; resumeState?: unknown;
}): boolean {
  if (job.target && job.target !== state.merchantCharacter && protectedMerchantRecipient(state, job.target)) return true;
  if (job.reason !== 'merchant commerce') return false;
  const progress = job.resumeState as {phase?: string} | undefined;
  if (['leveling', 'crafting'].includes(progress?.phase || '')) return false;
  const order = job.order as {sources?: Record<string, unknown>} | undefined;
  return Object.keys(order?.sources || {}).some(name => protectedMerchantRecipient(state, name));
}
