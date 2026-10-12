# Native Halloween difficulty through reconstitution

Failure inventory before edits:986 add artifacts11759405178 show boss525/553 max_hp changed716600 to36000000 while same ID/hp survived. Later character frames disappeared; finally direct frame cleanup hid the original test failure. This was not a proven passed loot test.

Pinned native90052162 node/server.js irregular reconstitution calls new_monster with last_state. Constructor copies hp/id but not max_hp or fixture overrides; max_hp comes from current G catalog. calculate_monster_stats reads zone_stats, but cannot alone protect reconstruction because native constructor discards that field. Native HP-threshold history also resets as the native implementation dictates.

Reproduce with the exact upstream constructor and serializer before edits. Keep initial declared definition only for whitelisted same-ID native last_state construction; immediately restore the global definition. Preserve native warp, HP, identity, threshold spawner, damage, death, drop and loot behavior. Nonfixture bosses/adds use the ordinary native constructor. Per-instance stat overrides preserve declared speed/attack across recalculation; neither hits nor threshold counts are synthesized.

Cleanup must reacquire the native CODE runner before a one-time hook restoration and record failures separately without replacing the original scenario error. Never claim cleanup repair fixes combat/death reentry until real native E2E passes.
