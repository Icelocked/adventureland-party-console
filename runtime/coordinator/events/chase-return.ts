import { requestObject } from "../http/contracts.ts";

/**
 * A return home the boss chase still owes the party. It is kept until the switch succeeds,
 * so a refused switch is retried instead of stranding the party off home (#107).
 */
export interface ChaseReturn {
  from: string;
  to: string;
}

export function savedReturn(saved: unknown): ChaseReturn | null {
  const value = requestObject(saved);
  return typeof value.from === "string" && typeof value.to === "string" ? { from: value.from, to: value.to } : null;
}
