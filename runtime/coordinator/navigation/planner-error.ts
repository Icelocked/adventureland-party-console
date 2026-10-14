import type {PlanResult} from '../../navigation/contracts.ts';
/** Empty-path rejection; service callers still reject, HTTP may publish verified worker identity. */
export class UnreachableGoalError extends Error {
  readonly result?: PlanResult;
  constructor(message: string, result?: PlanResult) { super(message); this.result = result; }
}
