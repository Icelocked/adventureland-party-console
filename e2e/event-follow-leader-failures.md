# Followers split from the leader between simultaneous events: failure inventory

Written before the change. Seen live on US III with Slenderman, Mr. Green and
Mr. Pumpkin all live: a boss chase brought the party for Mr. Pumpkin and the
priest (leader) joined it, but the warrior and mage joined Mr. Green. Each
character picks its event alone in `activeCombatEvent()`: its current event,
then the earliest end, then list order. With nothing current, the followers took
the first live boss in their inherited list. A follower on a different event
from the leader gets no walk, so both stood idle for minutes, and a Town trip
did not change their choice. The status response carries the leader's target,
location and combat selection, but not its event.

1. **Followers still split.** When the leader has joined an event that a
   follower also has selected and live, the follower must attend that event,
   including switching away from an event it already joined.
2. **Different realm.** The leader's event only counts when the leader is on
   the follower's realm.
3. **Not selected by the follower.** A follower never joins an event it doesn't
   have selected (directly or inherited); it falls back to its own choice.
4. **No leader event.** Without one, today's choice is unchanged.
5. **The leader itself.** The leader keeps choosing as it does today.
6. **Flapping.** The leader changing events must not make followers bounce
   faster than the leader does: followers follow the leader's current event only.
7. **Dead or stale leader.** A leader report older than the usual freshness, or
   a dead leader, doesn't steer followers.

**live**: two Halloween bosses live at once, the leader joined to the one later
in the list; both followers must join and fight the leader's boss.

**Superseded by upstream (merged 10-09):** upstream's event priorities rank live
events by the selection order the follower inherits from its leader, ahead of the
current event, so the whole party picks the same boss. The fork's leader-follow
ranking was dropped in favour of it; the switch journey now sets the leader's
priorities and still covers entries 1–7.

## A return must not hold a member whose other selected event is live

Written before the change (corrected once while investigating). The warrior was
put into a return to checkpoint for Mr. Green while Mr. Pumpkin, also selected,
was live; the trigger was most likely a gap in live-event reports during a Town
trip. The coordinator refuses event travel to any member of an open return
(`travelAllowed`), and the warrior's live Mr. Pumpkin blocks its walk home
(`reunionBlocked` includes `activeCombatEvent()`), so it could do neither. The
same deadlock follows whenever one selected event ends while another is up, for
example one Halloween boss dying while another lives. The priest and mage then
waited in town.

8. **New returns.** A member whose fresh report lists another selected event as
   live is left out of the return for the event that ended.
9. **Open returns.** Such a member is released from an open return (route and
   pending entry dropped); a return left with nobody finishes.
10. **Genuine ends still return.** With no other selected event live, the return
    proceeds as today.
11. **Stale reports.** Only reports within the usual freshness count.

**live**: two Halloween bosses live, the party in Mr. Green; when Mr. Green is
deselected, both fighters must go on to fight Mr. Pumpkin, and no return may hold
them.
12. **Released members keep their return command.** Found by the leave journey,
    which failed 1 in 4 runs after entry 9 was first implemented: the release
    left each member's `event-return-town` command in the coordinator's command
    list. The character retried it every ~2.5 s, and each attempt set
    `eventReturnPending`, cleared `joinedEvent` and failed `/return-progress`
    with 409 "return workflow superseded". That cancelled every walk to the other
    boss, so `joinedEvent` flickered and the party never left town. This matches
    the live 409s in the merchant/fighter logs. Releasing a member now retires its
    pending command for that return cycle.

## After upstream dd93497: a failed walk to the left event blocks the next event

Observed in the leave journey after the merge: the Mr. Green walking leg failed
`owner-lost` when the return replaced it, the return then released both fighters
for Mr. Pumpkin, and every Mr. Pumpkin walk request was answered with the Mr. Green
leg's failure every 5 s for the rest of the run. Upstream's `retainedFailure` keeps a
failed event leg authoritative for any event request from the same navigation
revision, and `canReplace` only lets runtime turnover replace it.

13. **Other event blocked.** A failed walking leg for one event must not answer, or
    block replacement by, a walk to a different event. A request for the same event
    keeps upstream's retained failure and retry budget unchanged.

## Result

- Follower split: the switch journey fails without the leader-follow change (the
  follower stays on Mr. Green) and passes with it.
- Return deadlock and retry loop: `coordinator-event-observation.test.cjs`
  (retained isolated) fails without the release and passes with it, including the
  retired command. The leave and switch journeys passed 12 of 12 runs after the
  command retirement (the leave journey had failed 1 in 4 before it), with no
  `/return-progress` 409s in the fighters' logs.
- Upstream's Halloween journeys pass unchanged; one "native adds" run failed when
  god-loadout damage skipped the 50%/25% add thresholds (a burst-damage flake).
