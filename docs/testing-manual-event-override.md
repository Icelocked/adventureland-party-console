# Manual travel overrides the current event occurrence

A live Ice Golem incident exposed conflicting movement ownership: three fighters attended the same fresh occurrence while an explicitly selected farming-area convoy attempted Town and transport to Mainland. Event permission polling allowed them to rejoin Ice Golem, teleporting them back to Winterland and invalidating the convoy transition.

Explicit manual travel now skips that occurrence for the moved actors. Their event selections remain unchanged, and later native occurrences remain eligible. The persistent attendance ledger binds the skip to its native ID and realm, or to an anonymous occurrence until the normal missing-feed boundary ends it. Automatic farming relocation still yields to event occupancy. `resumeAfterEvent:true` retains its existing deferred-travel behavior; `/checkpoint` only records a waypoint.

## Failure inventory

The inventory and corresponding regressions were written before each implementation change. Preserve these boundaries:

- Invalid or rejected travel must not create an exclusion. Explicit character/party travel, Town, merchant home, return-to-leader and navigate-to-monster use the same occurrence policy.
- An individual actor's manual skip must not suppress unmoved followers or inherit through their leader. Existing inherited death/time limits remain effective.
- A successful prejoin authorization may precede the first attendance entry. Creating a missing exclusion requires the recorded participant, fresh authorization timestamp and exact authorization/native realm, a fresh status, and a connected, non-stale feed. Global selections and unproven legacy sessions cannot manufacture participation.
- Existing death/time reasons remain intact. A separate occurrence-local manual marker prevents `/event-disabled` from installing a competing return. Other actors' normal recovery and genuine defensive combat remain unchanged.
- Restart must retain the skip. A different native ID/realm or a genuinely ended anonymous occurrence must clear it for the next occurrence.

## Validation and artifacts

The retained policy suite covers the prejoin boundary and its stale, wrong-member, missing/wrong-realm, disconnected and unrecorded negatives, plus limit preservation. The combined retained validation passed 178 checks; runtime and E2E TypeScript checks passed.

`e2e/live-hunt-manual-event-override.spec.ts` is registered by the existing `live-hunt-*` glob. Its two native cases exercise `/command` and `/travel` against anonymous Halloween occurrences. The pinned native event loop replaces Mr Pumpkin feed entries without an ID; declaring an ID in E would only test a transient fixture value. Explicit native-ID turnover remains covered by the retained policy regression. Each requires real participation, actual Mainland arrival within 180 seconds, no competing return/rejoin, permission denial after coordinator restart, unchanged selections, and actual participation in the next declared occurrence within 120 seconds. Both cases wait for genuine missing-feed ledger retirement before publishing the next occurrence.

The declared native Mr Pumpkin catalog remains stable throughout the case, including irregular reconstruction and charge recalculation. Nested cleanup restores that exact owned catalog. Encounter removal is an explicit fixture lifecycle boundary, never a claimed player kill. Native movement, combat, joins and acknowledgements remain unmodified.

Successful cases attach `native-manual-event-occurrence-override` with both actual encounter IDs, command response, travel timestamps, bounded observations, attendance, native positions and events. Standard native artifacts retain failure context. Local native validation is currently pending; do not describe these cases as passing until their artifacts are verified.

The native retirement operation asserts the declared monster is temporary before calling silent remove_monster. The pinned implementation excludes temporary monsters from respawn scheduling, decrements the native count and removes the exact instance entry. The following native event loop therefore cannot reconstruct E from that removed monster. Artifacts retain retirement ID, temporary flag, remaining native type count and feed presence. No player kill is claimed.

The serial native run also exposed a setup boundary: the preceding terminal-return case intentionally leaves a living declared boss. Before manual actions, this case retires only exact previous __e2eHalloweenDeclared IDs and their real master-chain descendants using the same ownership inventory as Halloween setup. It rejects an unrelated live Pumpkin rather than deleting arbitrary world entities. The cleanup artifact retains IDs/types/master links and the remaining native boss count. This is a between-scenario declaration, never an in-fight shortcut or player kill.

CI fixture correction: the retained monster-popup test omitted the existing clock
port and status collection because earlier selection never read them. The new
manual occurrence guard requires both. Supply a deterministic clock and empty
status collection to represent no active event; preserve every original override
assertion. CI d009eb2 had this sole unit failure (ports.now is not a function).
