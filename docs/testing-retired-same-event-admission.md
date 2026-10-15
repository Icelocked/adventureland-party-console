# Retired same-type event admission

## Failure inventory before code

Run 38452758672 shard 8, artifact 11844360600, failed stale-peer native event admission after 12 seconds. The old historical Pumpkin return was absent from current recovery, but deferred checkpoints remained. Warrior was fresh, connected, native event clock valid, and reported current live Pumpkin; Priest status was deliberately stale while its native connection stayed alive. Warrior only had a global session with no participants. Its old deferred return command was reissued and walked toward Main, preventing the client from requesting actual new-event authorization.

The nextLiveEvent helper intentionally excludes the returning event for active recovery. That exclusion is correct for the original live event after a limit, but a retired recovery must not force a still-enabled, attendance-authorized same-type event behind its obsolete return. Application authorization already checks selected events, ignored native attendance instances, dungeon admission, and manual cancellation. No native event identity is invented when the feed has no ID.

Failure cases: missing/stale/disconnected/clock-stale feed; cancelled or changed navigation intent; disabled event; ignored original live instance after time/death limits; active current recovery; already-issued exact old command; unrelated manual command; stale peer must retain its checkpoint. No global sighting may manufacture participation or erase the deferred checkpoint. Actual authorize must adopt it.

Validation uses retained observation/attendance/composition exceptions with tests written before the amendment, then the unchanged 12-second native admission/20-second stale-peer fault and actual hit/recovery proof.

Persistence failure inventory before the supplemental amendment: activeConvoy is a persisted snapshot field, while commands are ephemeral. Its owned cancellation callback clears the live convoy without saving settings. A restart could restore the retired walk before actual event authorization. Save once only after an actual owned walk cancellation; repeat waiting reports and rejected ownership must not write.
