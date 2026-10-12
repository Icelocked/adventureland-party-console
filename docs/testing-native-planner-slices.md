# Native BFS responsiveness

Failure inventory before production changes: synchronous hidden native BFS can
consume 500 milliseconds per call while the managed scheduler runs every 80 ms.
Three captured Cave searches expanded the same 94,555 vertices. With the native
hidden branch, a 100-ms heartbeat was delayed up to 2,921 ms; with its existing
visible 40-ms branch, maximum delay was 96.6 ms. Paths and endpoints remained
identical. This nearly exhausts existing three-second communication and combat
freshness fences. Native run 38266062273 and focused 38270026932 also retained
route/fight stalls and fresh-report expiry. The offline experiment establishes a
blocking mechanism, not proof that every native CI failure has the same cause.

The compatibility hook must affect synchronous BFS start/next calls only and
restore the exact original visibility function after success, exceptions, or
cancellation. It must fall back without mutation when the game-file version is
unknown, the parent hook is missing, or its property is not a writable data
property. It must never change document visibility, clock functions, installed
runner code, movement execution, deadlines, or owner/freshness checks.

Verified sources: pinned native fixture 15555 at upstream commit
90052162eb3ebda36c893e1eb4af643913c8f984, js/runner_functions.js:2706,
and installed game-file version 17665, runner_functions.js:2720. Both BFS routines
read parent.is_hidden synchronously to choose 40/500-ms slices; the parent global
function is_hidden reads document.hidden. typed-adventureland omits this internal
visibility hook. Reverify and expand the explicit version allowlist when adopting
another runner version.

Retained isolated regressions are in `native-planner-slice-budget.test.cjs`;
write/run them before modifying the adapter. Replay the exact captured Cave
geometry with `node tools/game/replay-native-planner-slices.cjs`. The standalone
JSON compares every original native path step with managed planning, records
frontier/tick counts, and verifies exact visibility restoration after every tick.
The replay performs no movement, timers, or network requests. Real native Cave
CI remains the integration check; do not treat offline route parity as a passing
native gameplay scenario.
