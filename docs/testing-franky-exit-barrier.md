# Franky evacuation with a living attacker

Failure inventory recorded before changing production behavior:

- Native run 38551000643 shard 8 reached the exit door with both participants alive
  and stopped, but the pre-transition barrier waited indefinitely. Franky still
  targeted the Priest; neither a timeout nor a longer route explained the stall.
- The authorized `franky-exit` walking fallback disables combat handoff but is not
  a continuous return. The ordinary departure-combat check therefore required the
  living attacker to disappear before allowing escape through a door.
- Only an owned Franky evacuation command with navigation exemption and combat
  handoff explicitly disabled may pass a non-Town transition despite an attacker.
  Ordinary travel, partial/mismatched evacuation flags, Town cast safety, loot
  readiness, route identity and fresh stopped party acknowledgements must remain.
- Record the exact readiness regression before implementation in the retained
  barrier-communication tests. Native E2E must observe a real party attacker before
  deselection, preserve the 90-second departure deadline and actual Mainland
  arrival, and leave Franky alive. Do not synthesize transition acknowledgements.

For stronger native encounter coverage, retain Franky's native reach and pursuit
instead of zeroing them; only the existing low-damage/no-adds declaration remains.
Observe a real party target before deselection. Native attacks and transitions
remain unmodified while the test exercises evacuation from a living attacker.

The captured CI failure and pre-change isolated readiness failure establish the
blocked-door regression. Local native runs can still escape with the old code
when the attacker clears; do not treat an old-code local pass as disproving the
captured stall or claim these encounter declarations guarantee it.

The corrected native scenario passed locally in 1.9 minutes. Its evidence records
Franky targeting the Priest before deselection, the actual Town-failure walking
fallback, and both actors alive on Main while Franky remained alive. The combined
Franky/cold-defense run passed two scenarios in 4.6 minutes with 95 verified files
under `.build/franky-cold-defense-passing/`. All 63 focused barrier/convoy tests
passed; the owned-door readiness case failed before the production correction.
