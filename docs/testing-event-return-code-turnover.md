# Event return survives CODE turnover without serializing recent peers

Failure inventory before code:
- Full685 run38231718131 shard10 has a real MrGreen exit with CODE replaced during an owned walking child. The coordinator retains its cycle/checkpoint/revisions.
- Artifact11742462761 starts an exit convoy for Warrior alone at+3.1s while both fighters remain in recovery.pending. Priest cannot start its separate exit until+175s; checkpoint dispatch occurs+233.2s of a240s deadline.
- The forced CODE replacement creates one10.1s communication hold, so loosening hold timers does not address the main latency.
- The early-finishing Warrior resumes saved farming while its peer still exits. Final native coordinates put Warrior in level1 and Priest in Main, adding another rendezvous before checkpoint return.
- Local eventReturnPending/shared-walk/exit-owner state is lost with CODE. The ordered authoritative eventReturnCycleId remains in real status responses, but the movement/return-defense gates do not consult it.
- A same-cycle native peer only slightly older than3s is removed from the coalescing roster. Admission must still require3s actual freshness; temporarily reserving the existing10s walking-request window for that peer avoids unnecessary serial legs. Dead, remote-server, expired, unknown-runtime and superseded-parent/revision peers cannot delay the first safe exit.

Regressions precede implementation. They verify real coalescer starts/participants/parents and defensive eligibility under retained/missing/retired ownership, not source text or callback order. The final native MrGreen journey retains240s total deadline, forced CODE turnover, native death/reentry/attacks and actual saved-checkpoint arrival. Do not deploy the candidate.

Private verification: five behavioral regressions failed before maintained changes. After the fix,64 walking/ownership/farming tests and76 event/communication/defensive-return tests pass with zero skips; runtime TypeScript passes. Pinned installed17665 geometry was supplied explicitly to old helper-based farming checks. Before/after ledgers are retained under the private worktree's .build/return-before.log and .build/return-after.log; actual native MrGreen completion remains required after integration.
