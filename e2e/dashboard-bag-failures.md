# Dashboard bag: failure inventory

Written before the change (2026-10-17). Observed live: the dashboard showed FonzeRogue at
about 27/42 at its lowest while every heartbeat reported 11–20 items. The dashboard stream held
17 items in slots 23–41 that the merchant had already collected; the coordinator's heartbeat
status had nothing there. Live journey: `e2e/live-dashboard-bag.spec.ts`.

1. **Dropped removal.** A character's dashboard sampler sends only changed slots. When no
   dashboard is connected, `/dashboard-telemetry` answers `{accepted: false}` and discards the
   sample, but the sampler treats any answered request as delivered and never sends that change
   again. A slot emptied while the viewer reconnects keeps showing its old item.
2. **Stale snapshot.** A reconnecting dashboard receives the coordinator's stored record. Once
   fast telemetry has started for a runtime, the heartbeat no longer refreshes that record, so a
   dropped change persists until the character's runtime or the coordinator restarts; reloading
   the dashboard does not clear it.
3. **Live updates changed.** With a dashboard connected, item additions and removals still reach
   it as deltas.
