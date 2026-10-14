# Completed and exhausted travel recovery

Failure inventory, recorded before implementation:

- Cave movement completes at the stairs, combat displaces a member, and the
  coordinator never replaces its completed receipt. Both fresh positions and
  current command identity must be checked, not just the historical receipt.
- Recovery must wait for combat, stale reports and paused choices; it must not
  replay votes, transport, another run's commands or a newer destination.
- Repeated displacement needs a bounded, visible failure. An outstanding repair
  must not generate another command on every heartbeat.
- Event walking can plan Town again after the coordinator sets disableTown,
  exhausting all retries on the same unusable shortcut.
- Exhausted event entry can strand survivors while dead peers respawn in Main.
  Recovery must preserve saved checkpoints, skip only that occurrence and retain
  normal defense. Restart must not reset the exhausted occurrence.
- A stale failure must never replace newer manual navigation, another event,
  another profile, merchant interruption or an existing return.

Retained isolated Cave and shared-walk regressions exercise identity and failure
guards before the implementation. Native validation uses the full Cave entry
journey (including farewell acknowledgement and actual next-floor transport) and
event entry recovery with actual native walking/return receipts. Save movement,
command and attendance evidence and run the E2E artifact verifier. Build a
completed immutable artifact; do not activate the user's running console.

The Cave journey drops the warrior's first completed-stairs status packet while
performing a collision-checked native walk over 60 units away. Subsequent real
status must produce a new independent command and both characters must transport
to the next floor. The packet/position/command ledger is in stairs-readiness.

`live-event-entry-failure.spec.ts` refuses current event planner HTTP requests:
one Town-unavailable refusal must produce a request with Town disabled followed
by native boss damage from both fighters; three entry refusals must exhaust the
real retry budget, recover both actors to Main, and preserve the occurrence skip
after coordinator restart. No movement success or combat receipt is synthesized.
