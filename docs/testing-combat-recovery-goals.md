# Hitbox-aware terrain recovery goals

Failure inventory, recorded before implementation:

- Melee recovery around a large Phoenix can produce zero goals because attack reach is an edge distance but the sampling circle uses a center distance.
- A short native warrior reach (23 units) can be exceeded by the old safety-plus-12 margin (26 units). Recovery goals must stay inside actual weapon reach without weakening monster safety exclusions.
- Small monsters can reject every melee goal for the same reason.
- Feet-based vertical coordinates make above and below offsets asymmetric; adding half-height uniformly is incorrect.
- Solving only for the selected monster must not admit goals inside another monster's safety radius or inside terrain.
- Ranged recovery must continue to offer goals within native attack reach.
- A +100 fixture priest weapon inflates attack range enough to engage a Phoenix 425 units away immediately, bypassing planned terrain recovery. Use native ordinary-range weapons with defensive survival gear for this scenario.
- Recovery goals must remain finite and deterministic when native dimensions are absent.

Validate native party recovery around blocked approaches and retain actual goal coordinates, native hitbox distances, terrain checks and attack receipts in the focused combat E2E artifacts. A route proposal alone does not establish successful combat recovery.

The native journey observes read-only goal calculations through the existing `sharedRoutine.terrainRecoveryPorts()` consumed by the real recovery client, only when the actual selected encounter is the visible seeded Phoenix. Local combat recovery can now reach the target without requesting a coordinator-wide pause; therefore pause admission is not required to observe this geometry. Every retained goal must satisfy native hitbox distance, collision, safety and weapon reach, followed by an actual warrior attack receipt.

## Phoenix fixture catalog/wire mismatch

Before the fixture edit, full run 38231718131 (685e383) computed six legal
hitbox-clear Phoenix recovery goals but missed the 60-second actual Warrior-hit
check. Artifact 11742272716 records a target shown with native default 160,000HP
and predicted movement from (738,1702) to (687,1698), despite the fixture declaring
10,000,000HP and zero speed. The first real Warrior attack landed for481 damage
about60.8 seconds after the measured goal receipt; no damage is synthesized.

Pinned upstream `monster_to_client` omits speed/hp/max_hp when equal to the server
catalog. Mutating that catalog after client login therefore made the server omit
all three overrides while clients retained their original catalog. Before-code
replay `.build/phoenix-native-wire-replay.json` proves original wire has none of
the override fields and materializes client defaults speed50/HP160000. Keeping
catalog speed/HP baselines and declaring stationary:true emits actual per-monster
speed0/HP10000000/max_hp10000000 overrides instead.

The fixture must explicitly wait for that real native HP/stationary observation
before measuring its geometry. Retain native terrain, goal hitbox checks and the
same60-second actual Warrior damage requirement. Restore the original catalog
in finally, and retain the native seed wire as evidence. This is fixture setup,
not a movement routine replacement or a longer combat deadline.
