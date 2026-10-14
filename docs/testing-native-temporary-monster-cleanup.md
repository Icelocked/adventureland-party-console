# Native temporary monster cleanup accounting

Pre-change inventory: owned Hawk calibration/primary/successor and Sparkbot/Goo fixtures create actual native monsters with temp:1, but remove surviving owned entities with nospawn:true. Native remove_monster in the pinned server excludes respawn for target.temp independently, while its map_def.live and monster_c decrement is guarded by !args.nospawn. Thus nospawn:true unnecessarily leaves counts inflated across cases.

Only exact owned temporary cleanup now uses ordinary disappear removal, guarded by ID lookup, temporary flag, type, map and instance. Calibration cleanup has the same temporary/type/map/instance guard. Existing broad ambient removal remains unchanged. Dead entities already removed by native combat are absent and are not decremented twice.

The two Targetron tests already use ordinary silent removal for their exact owned temporary IDs, so they need no nospawn amendment. No gameplay input, deadline or assertion changes are made. This incremental patch is intended after the separate safe roaming input and range-ten margin patches. The parent's ongoing native batch is not changed or rerun.
