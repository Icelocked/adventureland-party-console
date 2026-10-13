import type { PlanResult, Point, Step } from '../navigation/contracts.ts';

/** Local owned-route cache protocol; never a complete native smart-move state. */
export interface SharedRouteRemainder {
  id: string;
  revision: number;
  runtimeId: string;
  destinationKey: string;
  destination: Point;
  origin: Point;
  server: string;
  geometry: Pick<PlanResult, 'version' | 'fingerprint'>;
  transporting: boolean;
  plot: Step[];
  source?: string;
  /** Absent for older caches and non-continuous navigation. */
  townAllowed?: boolean;
}
