# Market listing preferences

Failure inventory recorded before implementation: stale rows leak through a tab;
Ponty grouping mixes old quantities into fresh rows; unchanged classifieds are
incorrectly treated as stale; ignores hide other levels or only one seller/tab;
missing level and +0 differ; preferences disappear after refresh/restart/import;
remove/clear fails to restore listings; ignore buttons submit a purchase; failed
saves disappear silently; settings start expanded or clear controls sit outside
their section; secondary buttons cannot be read against the dark panel.

Browser journeys use the real dashboard, coordinator and saved settings. Market
feeds are declared external ALData/Ponty observations, not fabricated purchase
outcomes. Retain screenshots, preference ledgers and repeatable browser traces.

Run the console project with `--grep 'market listing filters|market ignores|WTB stand and market'`.
The optional marketStand fixture supplies a native WTB slot observation using
the pinned game's item metadata. It does not synthesize purchases or sales.
The journeys verify all four stale filters, exact-level ignores across tabs and
restart, individual removal, clear-all restoration, collapsed settings and header
clear-button placement, and WTB display labels. Run `node e2e/verify-artifacts.cjs`
after completion and retain the report, screenshots and saved preference ledger.
