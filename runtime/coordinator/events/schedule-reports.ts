interface Schedule {
  [key: string]: unknown;
}
interface Report {
  seenAt: number;
  server?: string;
  eventSchedules?: Schedule[];
  eventFeedAt?: unknown;
  eventClockStale?: unknown;
  eventFeedConnected?: boolean;
}

/** Prefer the latest feed among fresh reports from the leader's realm. */
export function projectEventSchedules(
  statuses: Record<string, Report | null | undefined>,
  leader: string | null,
  now: () => number,
): Schedule[] {
  const server = statuses[String(leader)]?.server;
  const reports = Object.values(statuses).filter(
    (report): report is Report & { eventSchedules: Schedule[] } =>
      !!report &&
      !!report.eventSchedules &&
      now() - report.seenAt < 15000 &&
      (!server || report.server === server),
  );
  reports.sort((a, b) => Number(b.eventFeedAt || 0) - Number(a.eventFeedAt || 0));
  const report = reports[0];
  return report
    ? report.eventSchedules.map((event) => ({
        ...event,
        // server_info is change-only. A fresh connected heartbeat with a synced
        // clock retains the confirmed calendar even when no event changed lately.
        stale: report.eventFeedConnected === false || !!report.eventClockStale,
        ...(event.id === 'witchcipher' ? {cipher: cipherView(event, statuses, report.server, now())} : {}),
      }))
    : [];
}

function cipherView(event: Schedule, statuses: Record<string,Report|null|undefined>, realm: string|undefined, now:number) {
  const view = event.cipher as {merchant?:string;runtime?:unknown} | undefined;
  if (!view) return view;
  const merchant = view.merchant && statuses[view.merchant];
  const observation = merchant && now-merchant.seenAt<15000 && merchant.server===realm
    ? merchant.eventSchedules?.find(entry=>entry.id==='witchcipher')?.cipher as {runtime?:unknown}|undefined : undefined;
  return {...view,runtime:observation?.runtime};
}
