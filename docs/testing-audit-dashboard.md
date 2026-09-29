# Dashboard test audit

Historical first-pass audit. The follow-up [replacement matrix](testing-replacement-matrix.md)
supersedes the retention decisions and records subsequent removals.

Scope: 38 dashboard/UI test files from PR #21. The initial browser suite exercises real dashboard/coordinator settings persistence and Hunt controls. Retained cases below catch distinct failures that those journeys do not exercise; retaining them is not an endorsement of adding renderer tests for future features. Prefer extending E2E coverage and remove the matching isolated case once that coverage runs.

Removed **4 complete tests** from 2 files, plus source/CSS-token assertions from mixed behavior tests. No production behavior was changed. Assertions that only match source spelling or Tailwind classes cannot establish runtime wiring, computed contrast, portal interaction, or pointer hit-testing. Browser assertions must observe those directly. Existing failure/ordering tests remain until a repeatable browser scenario actually replaces them.

| File in `scripts/tests/` | Decision | Failure coverage or removal reason |
| --- | --- | --- |
| `bank-withdrawal-dialog.test.cjs` | Retain | Confirmation dismissal, failed retries, original selection, and duplicate withdrawal prevention. |
| `console-updates-ui.test.cjs` | Retain | Managed versus development update controls and restart/automatic-update request payloads. |
| `dashboard-action-errors.test.cjs` | Retain | Draft retention across failed economic actions, partial bulk-sale retries, validation, and structured rejection ownership. |
| `dashboard-build-cache.test.cjs` | Retain | Real filesystem fingerprints detect edits but ignore generated files; browser journeys do not rebuild changed source. |
| `dashboard-card-optimizations.test.cjs` | Retain | Connected-card render isolation and latest callback identity under frequent movement updates. |
| `dashboard-catalog-batching.test.cjs` | Retain | 250-item scrolling, bounded batches, filtering, and reopen reset; small E2E catalogs miss this. |
| `dashboard-character-stats.test.cjs` | Trim | Retain observer cleanup, live equipment updates, request isolation, and portrait identity; remove three class-token assertions that cannot prove pointer behavior. |
| `dashboard-doll.test.cjs` | Retain | Steam blob/file URL portability, cosmetic layers, cache reuse, and unknown-image fallback. |
| `dashboard-live.test.cjs` | Retain | Reordered samples, stale runtime generations, leases, slot reuse, disconnect cleanup, and sampler backpressure. |
| `dashboard-minor-improvements.test.cjs` | Retain | Attachment draft preservation, BankBoi duplicate creation guard, and offline/live portrait selection. |
| `dashboard-node-server.test.cjs` | Retain | Actual production Node server HTML, assets, and request bodies; a distinct deployment entrypoint. |
| `dashboard-optimizations.test.cjs` | Retain | Generation replacement, cache identity, countdown refresh/expiry, and per-domain diagnostic attribution. |
| `dashboard-query-render.test.cjs` | Retain | Subscription cleanup, hidden-tab behavior, changing map boundaries, and current action closures. |
| `dashboard-query.test.cjs` | Retain | Late fallback overwrite races, authentication cache clearing, mutation non-replay, and structured material conflicts. |
| `dashboard-recovery.test.cjs` | Retain | Timeout, abort, capped retry timing, instance identity, and supervisor failure recovery. |
| `dashboard-state-import.test.cjs` | Retain | Unsafe/malformed import rejection, backup failure, persistence rollback, and stale-preview invalidation. |
| `dashboard-stream-proxy.test.cjs` | Retain | Authenticated real SSE connections, heartbeat forwarding, and upstream disconnect cleanup for both hosts. |
| `delivery-trip-ui.test.cjs` | Retain | Pending edits, failed saves, disabled routine protection, and stale-save prevention. |
| `farming-browser.test.cjs` | Retain | Production browser bundling of CommonJS geometry and browser/runner entrypoint parity; source equality here protects two shipped copies, not styling. |
| `hunt-spawn-settings-ui.test.cjs` | Retain | Multiple-zone radio preferences and failed-save feedback, beyond the basic Hunt toggle journey. |
| `inventory-loading.test.cjs` | Retain | Incomplete reconnect snapshots must not replace inventories; bank reports must not trigger blocking drop-graph discovery. |
| `item-action-banner.test.cjs` | Retain | Conflicting processing/sale/storage rules and merchant ownership choose correct banners across combinations. |
| `item-action-menus.test.cjs` | Trim | Retain exact action callbacks, mark clearing, eligibility, lucky-slot choices, and banner precedence; remove footer/banner CSS-token assertions. |
| `item-action-safety.test.cjs` | Retain | Stale equipment/use commands reject invalid item types and changed inventory slots before game actions. |
| `lucky-slot-ui.test.cjs` | Trim | Remove the entire static outline CSS-token test and background-token assertion; retain physical slot indexing, evidence distinctions, and shared Tracktrix ownership. |
| `merchant-cancel-job-ui.test.cjs` | Retain | Automatic cancellation confirmation, duplicate suppression, and manual/automatic distinction. |
| `merchant-commerce-dialog.test.cjs` | Retain | Material rejection preserves cart, suppresses duplicate pending orders, and avoids unintended mark removal. |
| `merchant-visit-ui.test.cjs` | Retain | Offline/merchant exclusion and duplicate visit suppression. |
| `monster-popup.test.cjs` | Trim | Delete three source-text assertions for owner rendering, component wiring, and ordering implementation. Keep the actual navigation service test for atomic convoy override and authorization. |
| `monster-spawn-ui.test.cjs` | Retain | Distinguishes unknown versus absent spawn data, route restrictions, and stale catalog version refresh. |
| `party-console-polish.test.cjs` | Retain | Balance ownership, map frame scheduling, map-boundary cleanup, covered-canvas cleanup, and Steam promotion/cancellation races. |
| `passive-hunting-ui.test.cjs` | Trim | Remove a button CSS-token assertion; retain independent setting patches and nested-dialog lifetime behavior. |
| `pending-character-cards.test.cjs` | Retain | Pending Steam/headless state distinguishes connected ownership and prevents actionable invented telemetry. |
| `rare-hunting-ui.test.cjs` | Retain | Ordered Phoenix routes, invalid threshold rejection, read-only Fairy eligibility, and independent preference patches. |
| `send-to-party-ui.test.cjs` | Retain | Single versus multiple group selection and commands with stale/missing presence. |
| `solo-hunt-ui.test.cjs` | Retain | Follower saved mode remains editable while inherited effective settings remain read-only. |
| `upgrade-offerings-ui.test.cjs` | Retain | Single exact attempts, preview versus refresh, overlap validation, rejected saves, and unavailable calculations. |
| `wtb-dialog.test.cjs` | Trim | Remove source-regex callback wiring assertion; retain selected-level pricing, polling draft preservation, and fresh-dialog sessions. |
