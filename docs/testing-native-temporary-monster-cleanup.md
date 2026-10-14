# Native temporary monster cleanup accounting

Pre-change inventory: owned Hawk calibration/primary/successor and Sparkbot/Goo fixtures create actual native monsters with temp:1, but remove surviving owned entities with nospawn:true. Native remove_monster in the pinned server excludes respawn for target.temp independently, while its map_def.live and monster_c decrement is guarded by !args.nospawn. Thus nospawn:true unnecessarily leaves counts inflated across cases.

Only exact owned temporary cleanup now uses ordinary disappear removal, guarded by ID lookup, temporary flag, type, map and instance. Calibration cleanup has the same temporary/type/map/instance guard. Existing broad ambient removal remains unchanged. Dead entities already removed by native combat are absent and are not decremented twice.

The two Targetron tests already use ordinary silent removal for their exact owned temporary IDs, so they need no nospawn amendment. No gameplay input, deadline or assertion changes are made. This incremental patch is intended after the separate safe roaming input and range-ten margin patches. The parent's ongoing native batch is not changed or rerun.

Ambient isolation failure inventory before amendment: d009eb2 shard 12 ran both
Main hawk scenarios successfully, then the later follower-completed Hunt waited
210 seconds at its Goo area without a single hit (leader quest still 2, follower
0). Both native actors had no candidate. The hawk setup removed all live Main
monsters with nospawn:true, so only already queued respawns were restored; live
Goos were permanently erased. Remove ambient monsters through normal native
removal first, then temporarily extract all resulting map respawn entries. Restore
those exact entries at teardown; do not manufacture new monsters or reset native
counters. Apply the same ordering to the UHills scenario. Validate both hawk cases
followed by the failed Hunt in one worker and the same native server instance.

Revised pre-change inventory: normal removal is not reversible isolation. Grow packs schedule native respawn callbacks after 25ms outside monster_respawns; irregular relocation schedules last_state reconstruction after 500ms. Local serial Hawk reproduction admitted unrelated ambient Hawks 601-626 after normal removal and queue extraction. Native itself pairs nospawn removal with last_state reconstruction for irregular relocation. Preserve actual ambient objects and native counters, restore original definitions before reconstruction, and verify returned identities and unchanged reconstruction accounting. Already-pending callbacks require explicit handling rather than an assumed sleep interval.

Implemented isolation forwards every native constructor call unchanged, retains actual map-return objects, and removes them with nospawn:true. Only explicitly tagged fixture map descriptors combined with temp:1 are exempt; ordinary native temporary grow-pack monsters remain isolated. A keyed native-ID ledger handles delayed last_state reconstruction of a previously retained ID without duplicate restoration. Existing queued respawns are held separately. No timers are replaced or slept through. Teardown restores the exact constructor identity before official last_state reconstruction; verifies each returned native ID/type/map/instance and unchanged per-type monster_c and pack.live before/after restoration; then returns held respawns even on restoration failure. Actual constructor-created IDs and accounting receipts are attached. Real subsequent Hunt kills and rewards remain the native population proof.

Main Phoenix has a native randomrespawn descriptor. Official reconstruction may choose another declared native boundary; retain original and reconstructed map/instance in the receipt and require the actual returned instance to be one of that original descriptor's boundaries, with matching authoritative instance map. Ordinary packs must restore the same map/instance. No native position or random choice is overridden.

Exception-safety inventory before amendment: setup can install isolation before its HTTP response fails, outside the test finally; Sparkbot transport evidence can throw before restoration; one native reconstruction error can abort restoration of all remaining retained ambient. Move setup into the protected test body, allow teardown to no-op only when native isolation state is truly absent, nest evidence inside guaranteed cleanup, and attempt every retained native restoration before rethrowing the first error. Constructor ownership mismatch remains an error.
