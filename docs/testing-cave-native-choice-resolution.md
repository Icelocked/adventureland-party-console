# Native Cave vote resolution race

Failure inventory before fixture changes:

- Full native run 38228085482 passes boss assembly, native Lockbreaker completion, and the declared duel. During later required-room traversal, a vote button resolves enabled but disappears before input dispatch completes.
- Retained artifact 11738073534 shows the same Two People Claim the Chest choice already resolved to `left`, both actual native votes are `left`, the opposing NPC has negative HP, and all required rooms are complete.
- The fixture returns immediately after a click, allowing the next telemetry poll to use an older unresolved observation and attempt a duplicate vote. Raising timeouts or forcing clicks would conceal this race.
- An unrelated click error, a different native choice, another option, absent real vote receipts, or an unresolved choice must remain a failure. Native battle completion and physical travel requirements remain unchanged.

After the real UI input, require the same run/floor/choice to resolve with the exact option voted by both participants. A click timeout may be tolerated only when those identical native terminal receipts already exist. Keep the normal action timeout and retain a ledger of the observed choice/result; do not synthesize votes, deaths or completion.

## Temporary missing participant telemetry during required rooms

Before the fixture edit, focused run 38231702241 (685e383) reached the later
required-room loop then threw at live-cave.spec.ts:753 because the second member
reported `observation.cave=null` between two independently fetched snapshots.
The same run's lost-native-follower recovery case passed. Null telemetry must not
be treated as an empty/completed Cave, nor should the poll throw before its real
completion deadline.

The required-room poll must require exactly both participants, fresh native
observations with the original run/floor and actual points, before choosing or
claiming a room complete. It uses one snapshot for primary room state and the
other participant's unresolved vote, retaining the existing 300-second deadline,
real battle completion, vote receipts, native stairs and floor transition checks.
If a participant never returns to that run, the existing native completion check
still fails; this change does not re-enter Cave or synthesize an observation.

## New-floor shop already voted by stairs continuation

Before the follow-up edit, full run 38231718131 (685e383), Cave shard 1, reached
native floor 1 then timed out at line 806 clicking `Open the shop`. Artifact
11741322025 records that stairs continuation already answered choice
`2ec5a0cb5a478baf85628f6c:926`. Transition telemetry briefly carried only the
Warrior vote and unresolved state; final actual native observations on floor 1
show the same choice resolved with both Warrior and Priest voting `e31_0`.

The new-floor block must use the existing bounded same-choice acknowledgement
helper with explicit floor 1. It must not click an already-completed vote merely
because prior telemetry lags, and it must still require exact actual votes for
both members before dismissing the real native result. No timeout increases.

## Farewell continuation identity

Full run 38440823973 on `00a2562` started its 300-second post-vote
continuation from natural choice 212, titled "Before You Leave". The declared
`e2e-farewell` room at (672, 1952) was still unfinished; the actors were at
(1357, 1072). The declared room later resolved choice 317. Native route 9 took
about 269 seconds, followed by combat and regrouping. The early continuation
deadline expired about two seconds before regrouping completed. Both actors
were alive at the assembly point, with 533 seconds remaining in the visit.
The evidence does not establish an acknowledgement deadlock or visit expiry.

Match the native `run.cave.vote.id` and `vote.room.id` to the declared room
before starting the continuation window. Continue answering every intervening
native UI choice. At acknowledgement, require the declared room to be done
and its retained `room.vote.id` to match the selected farewell. Preserve the
600-second approach and 300-second continuation deadlines and actual floor
transport checks. Retain native room, vote and player coordinates as evidence.
