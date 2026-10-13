# Native lucky checkpoint input gate failure inventory

Canceled run 38330572924 shard 6 retained two completed failures: sequential and
locked best-effort restoration. Both fail at route.continue line 353 with
Route is already handled after actual cargo-change assertions succeeded. The
trace shows completion/roll assertions running while the original route handler
still performs CDP snapshots. The native ten-second request and route teardown
can outlive this multi-round-trip input mutation.

Declare the same changed cargo at the native AJAX before-send boundary instead.
Match one real merchant checkpoint's unchanged journal ID and restoring phase.
Preserve every unmatched call's receiver, arguments and return object. Forward
the matched original HTTP result/failure through jQuery Deferred exactly once,
preserve abort ownership, and never send a checkpoint after input failure,
missing Priest CODE, or replacement of the owning CODE frame. Input mutation
must use official send_item/swap and observed native inventory, not fabricated
receipts. No transport deadline or production assertion is widened.

Before implementation, retain real-HTTP browser cases covering unmatched calls,
held input with exact eventual request body, HTTP failure, abort before/after
send, input failure, and lost ownership. Native cargo/roll/restart outcomes
remain asserted by the existing two real-game scenarios.
