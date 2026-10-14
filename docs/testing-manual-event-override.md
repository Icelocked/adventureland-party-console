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

CI 38609591558 shard 13 exposed a fault-injection race: a late event planner
request shared the priest's runtime with the new manual convoy. The interceptor
aborted the old event destination while the coordinator was assembling manual
travel. Superseded recovery was correctly ignored and manual arrival succeeded,
but the intended assembly hold was never exercised. The fixture must match the
request journey to the actual client movement report and the corresponding
status sample's convoy, epoch, command, revision, runtime and rally destination
before aborting. A missing or
superseded owner, old destination, or concurrent second intercepted request must
pass through. The transport ledger retains unmatched requests and the selected
movement owner; all-party stopped recovery and real arrival remain mandatory.
Initial assembly calls generic navigation without a movement `owner` field.
Match its journey to the real status sample, which captures movement and convoy
identity together. Hold only an otherwise matching pending planner request for
at most five seconds while that status arrives; recheck current ownership on
every observation. A late event destination passes through immediately. An
ownerless movement report alone never authorizes the injected failure.
The corrected local run passed both entry points in 5.1 minutes with 70 verified
evidence files. The faulted case captured exactly one matching assembly request
and five fresh whole-party stopped holds, followed by native arrival, restart
persistence and attendance at the next occurrence.

Initial-assembly transport regression failure inventory (before implementation):
CI 38525662222 shard 13 lost the priest's `/movement-plan` request while the
party-travel convoy was still assembling. Both attendance exclusions remained
correct; no event rejoin occurred. The follower reported communication-hold,
but assembly had not initialized the shared runtime map, so recovery ignored it.
The native `/travel` case now drops exactly one real follower planning request
owned by the initial assembly. It must observe fresh matching stopped hold
acknowledgements from both actual clients, then real Mainland arrival within the
unchanged deadline, with no competing event return. Wrong command, epoch,
revision, runtime, stale report, later route generation and superseded ownership
must not gain this initial-assembly exception. A successful HTTP request or a
changed coordinator phase alone cannot establish recovery. Cleanup removes the
transport interceptor even on failure; the fault/hold ledger is retained.
Both actors are declared at separated, native-validated Halloween positions
before login. This ensures actual assembly is required; the first fault run
correctly rejected a co-located setup because it never issued a follower route
and therefore never exercised the fault. No connected actor is repositioned.
The supported initial console hold preserves those starting positions during
login. Configure independent attendance while held, release the hold, observe
both actual attendees, then enable following immediately before manual travel.
Otherwise normal following can legitimately finish assembly during fixture login
and erase the separated starting condition before the test begins.

The retained policy suite covers the prejoin boundary and its stale, wrong-member, missing/wrong-realm, disconnected and unrecorded negatives, plus limit preservation. The combined retained validation passed 178 checks; runtime and E2E TypeScript checks passed.

`e2e/live-hunt-manual-event-override.spec.ts` is registered by the existing `live-hunt-*` glob. Its two native cases exercise `/command` and `/travel` against anonymous Halloween occurrences. The pinned native event loop replaces Mr Pumpkin feed entries without an ID; declaring an ID in E would only test a transient fixture value. Explicit native-ID turnover remains covered by the retained policy regression. Each requires real participation, actual Mainland arrival within 180 seconds, no competing return/rejoin, permission denial after coordinator restart, unchanged selections, and actual participation in the next declared occurrence within 120 seconds. Both cases wait for genuine missing-feed ledger retirement before publishing the next occurrence.

The declared native Mr Pumpkin catalog remains stable throughout the case, including irregular reconstruction and charge recalculation. Nested cleanup restores that exact owned catalog. Encounter removal is an explicit fixture lifecycle boundary, never a claimed player kill. Native movement, combat, joins and acknowledgements remain unmodified.

Successful cases attach `native-manual-event-occurrence-override` with both actual encounter IDs, command response, travel timestamps, bounded observations, attendance, native positions and events. Standard native artifacts retain failure context. Both variants passed in the local four-case batch with both Pumpkin return cases (173 verified evidence files). The faulted `/travel` case recorded one actual dropped planning request and five fresh all-party stopped hold observations before genuine arrival and later event attendance.

The native retirement operation asserts the declared monster is temporary before calling silent remove_monster. The pinned implementation excludes temporary monsters from respawn scheduling, decrements the native count and removes the exact instance entry. The following native event loop therefore cannot reconstruct E from that removed monster. Artifacts retain retirement ID, temporary flag, remaining native type count and feed presence. No player kill is claimed.

The serial native run also exposed a setup boundary: the preceding terminal-return case intentionally leaves a living declared boss. Before manual actions, this case retires only exact previous __e2eHalloweenDeclared IDs and their real master-chain descendants using the same ownership inventory as Halloween setup. It rejects an unrelated live Pumpkin rather than deleting arbitrary world entities. The cleanup artifact retains IDs/types/master links and the remaining native boss count. This is a between-scenario declaration, never an in-fight shortcut or player kill.

CI fixture correction: the retained monster-popup test omitted the existing clock
port and status collection because earlier selection never read them. The new
manual occurrence guard requires both. Supply a deterministic clock and empty
status collection to represent no active event; preserve every original override
assertion. CI d009eb2 had this sole unit failure (ports.now is not a function).
