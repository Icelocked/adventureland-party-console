# Phoenix split search: failure inventory

Written before implementation. Each entry names the expected handling and how
it is observed. The live journey (`live-phoenix-search.spec.ts`) covers the
entries marked **live**; others rely on the coordinator design and review.

## Search

1. **Searchers bunch up.** Two fighters choose the same region while others are
   free. Assignment is one greedy round over a route-distance matrix. A region
   another searcher already claimed is used only when no free one remains.
   **live**: both fighters are in different spawn regions during the search.
2. **Async planner race.** A planning round finishes after the patrol was
   stopped, superseded, or reset by a kill. The result is ignored unless the
   same patrol and cycle are still current.
3. **Unreachable point.** A client `smart_move` fails or makes no progress for
   30 seconds. The point is skipped. If every point in a region is skipped, the
   region is marked incomplete for this cycle. If all five regions are
   incomplete, the patrol pauses with a visible reason.
4. **Searcher lost.** A searcher dies, reloads, goes stale, or becomes protected
   (event, low HP). Its claim is released so others can take that region; it
   gets a new assignment when it is fresh again.
4a. **A returning search assignment is rejected forever (reproduced in simulation).**
    Written before the fix. The client's loot filter (`runtime/combat/departure-loot.ts`)
    retires the id of every rare control it sees replaced and rejects that id from then
    on, so a finished loot or encounter cannot return. Search control ids are rebuilt
    from patrol, cycle, searcher, region and point, so the same assignment legitimately
    comes back: an Anniversary round withheld control (minutes 118.8-121.5), which
    retired the Spooky Forest assignment, and when the coordinator resent it every full
    status nulled it while the combat channel (which skips the filter) restored it. The
    control flipped once a second, each flip cancelled the route, farm recovery walked
    the searchers back toward the farm, the shuffling counted as movement progress, and
    the search never finished again (no kill for the last 70 minutes). Expected: search
    controls are never retired; a search assignment withheld and resent is accepted
    again; loot and encounter controls keep their one-way retirement.
4b. **A failed encounter route blocks the loot walk forever (reproduced in simulation).**
    Written before the fix. An encounter and its loot stage share one control id, and
    `pollRareHunting` never retried a failed route for that id (search and converge
    routes already retry after 5 s; the coordinator only reads failures for search
    points). A walk stopped mid-fight by another mover ("Unattributed movement stop")
    left the leader idle with the loot control for 15+ minutes: the loot stage never
    ended, and the leader stayed out of the search. Expected: encounter and loot routes
    retry after the same 5 s, so the leader walks to the kill and loots.
5. **Coverage before respawn.** A searcher reaches a region before the Phoenix
   has respawned. It waits at the region's first point. Coverage counts only
   observations taken after `readyAt`, plus the one-second dwell.
6. **Endless empty cycle.** All five regions are covered and no Phoenix was seen
   (another party killed it, or it wandered). A new coverage cycle starts.
7. **Long client routes.** Cross-map walks take longer than the old 30-second
   rare route timeout. Search, converge, shadow and engage routes have no
   client timeout; the coordinator's no-progress watchdog decides.
8. **Searcher attacked.** A monster targets a lone searcher. The client releases
   movement and combat ownership to ordinary defense until no visible monster
   targets it, then resumes the same control.

8a. **Searcher stalls under attack (hypothesis, not reproduced).** The live
    stall happened at a Mainland bee spawn. The live journey starts both fighters
    there, but level-80 fighters were not attacked and walked straight out, and
    the live stop stacks pointed to 8b instead. No code change; the journey stays
    as coverage that a search starting on an aggressive spawn still covers a
    region. If a lower-level searcher is ever seen stalling under attack, the
    suspects are grouped-mode target admission (it may block attacking a lone
    attacker) and a watchdog that counts back-and-forth movement as progress.
8b. **Party-wide pause from one fighter.** Seen live: FonzeWarrior's status
    responses alternated between a search control and none, and each empty one
    cancelled its route, so it shuffled in place for over 30 seconds. Every
    member's pending command, low HP, or event, and a leader heartbeat older
    than 3 seconds, paused the whole patrol. Each pause also cleared every
    assignment. While searching, only party-wide conditions (town, recovery,
    escape, events, Hunt turn-in, leader missing over 10 seconds) pause the
    search; a fighter's own condition removes only that fighter. Assignments
    survive pauses and heartbeat gaps under 10 seconds. A rate-limited
    diagnostic names the fighter and condition whenever a search control is
    withheld.
8c. **One fighter's condition ends the whole converge (seen live, 10-18).**
    Written before the fix. 8b applies only while no encounter exists: once a
    Phoenix is sighted, `blocked()` and `control()` use the party-wide
    `protectedActivity()` again, so any member's own condition ends the
    encounter. Live: the merchant handed items to FonzePriest mid-converge
    (`command merchant-handoff/-`), the encounter ended "interrupted by
    protected activity", every member's search assignment came back (the warrior
    turned back to its old scan point, the priest was sent to the cave), and the
    encounter restarted 8 s later from scratch. Expected: while converging, as
    while searching, only party-wide conditions pause the patrol; the busy
    member's control is withheld and it counts as not yet gathered (the gather
    deadline still bounds the wait), and the others keep converging on the same
    encounter. Once gathered, the party-wide rule applies again. Ways the fix
    could fail:
    - The encounter still ends or is replaced while one member is busy.
    - The busy member still gets a converge control and walks off mid-handoff.
    - The busy member is counted as gathered, so the fight starts without it.
    - A party-wide condition (town, recovery, event, leader missing) no longer
      pauses a converging patrol.
    A busy member that is the only one with the Phoenix in sight stops
    shadowing, so the encounter can still end through entry 12 ("Phoenix lost
    while the party converged") and the search resumes; that is the ordinary
    lost-sighting path, not this failure.
    Not covered: a member whose condition outlasts the gather deadline. In E2E
    an idle priest at 20% HP never heals back over 35%, so the party engages
    without it and the post-gather party-wide rule then ends the encounter.
    **live**: the converging (non-spotter) fighter drops to low HP right after
    the sighting and is healed 15 s later (a declared stand-in for a handoff);
    the same encounter continues, and both gather.
8e. **A converge control withheld and resent is rejected forever (seen live and
    in E2E, 10-18).** Written before the fix. The 8c change withholds a busy
    member's control and resends the same encounter id when it is free. The
    client's loot filter (`runtime/combat/departure-loot.ts`, see 4a) retires
    every replaced rare control id except search ids, so the withheld converge
    id was rejected on every later full status while the combat channel (which
    skips the filter) restored it. Live, FonzePriest after a merchant handoff
    and later FonzeWarrior wiggled in place, cancelling the converge route about
    once a second (69 cancels in 2 minutes, every stack `cancelRarePath <-
    tick`); temporary probes showed the coordinator sending the control in every
    response while the client read null. In E2E the healed fighter of 8c
    cancelled 279 times after the heal. Expected: like search controls,
    converge and engage controls can be withheld and resent, so they are never
    retired; encounter and loot controls keep their one-way retirement.
    **live**: in 8c's journey (the busy fighter also waits in town, as after a
    handoff), the healed fighter's route is not cancelled by the status loop.
8f. **Another fighter's distant fight pulls the spotter off the Phoenix (seen in
    E2E, 10-18).** Written before the fix. `rareActive()` returns false for every
    member while any grouped fight is unfinished (a converge/engage exemption
    exists only for fights on the Phoenix itself). In 2 of 5 runs of the main
    journey, the warrior crossing Mainland got "Group engaged" on a hawk while
    the priest shadowed the Phoenix in Spooky Forest; the priest lost its rare
    control, farm reunion walked it to main town, the encounter ended "Phoenix
    lost while the party converged", and both fighters then stalled in town and
    at the Spooky Forest entrance until "All Phoenix regions unreachable".
    Expected: on a search or converge leg, a fight this fighter cannot be part of
    (another map or instance, or more than 600 units away) does not switch its
    rare control off; a fight next to it still does, so it defends itself as
    before. Ways the fix could fail:
    - The fighter that is actually fighting keeps walking its rare route.
    - A nearby fight no longer stops a searcher (entry 8 defense).
    - Engage and encounter controls start ignoring the party's fight.
    **live**: with a fast hawk forced onto the converging warrior, the priest
    keeps shadowing the Phoenix on another map and the encounter survives.
8d. **A searcher pinned by an attacker it can outrun (seen live, 10-18).**
    Written before the fix. FonzePriest (speed 68) walking past the Mainland
    Hawk spawn (bigbird: speed 24, aggro 1, 32k HP, 480 attack) was targeted.
    `rareUnderAttack()` cancelled its route for any attacker, and the
    coordinator committed the hawk as the party's fight, so the priest stood at
    (1264, 274) for over 280 s healing itself (87 heals and 12 MP potions in 5
    minutes, never in attack range) while the others waited at the gather with
    "converging 2/3". The general outrun-or-kill rule (946a7bd) was removed on
    10-08 with no upstream issue; on 10-18 the user chose to restore it for
    Phoenix search and converge legs only. Expected: on a search or converge
    leg, an attacker the fighter is faster than is walked away from along the
    existing route (no route cancel, no hovering or kiting in place), and the
    coordinator never makes it the party's fight from any member's report. An
    attacker that keeps up (equal or faster) is fought before moving on, even
    though the queue never nominated it. Outside Phoenix legs nothing changes.
    Ways the fix could fail:
    - The client walks on but the coordinator still selects the attacker, so
      the party deadlocks on a fight nobody takes (seen when 946a7bd was first
      tried client-only).
    - The fighter walks on from an attacker that is as fast as it is and dies.
    - The Phoenix itself is treated as an escaped attacker while converging.
    - Farming, convoys or other travel start ignoring attackers.
    - A neighbour takes it on (seen in E2E): with both fighters in the east
      region, the warrior taunted the hawk chasing the priest and both then
      fought it. On a Phoenix leg nobody targets a monster chasing a party
      member that can outrun it.
    **live**: the priest searches from the Hawk spawn with a hawk targeting it;
    it leaves the spawn, nobody fights the hawk, and the search covers a region.

## Sighting and convergence

9. **Spotter attacks too early.** While anyone is converging, the client rejects
   the Phoenix as a target unless someone is already fighting it.
   **live**: no party hit lands on the Phoenix before every fighter is in range.
10. **Premature grouped selection.** Patrol candidates are not fed into grouped
    combat while the encounter is converging, so formation cannot select the
    Phoenix early.
11. **Sighting on another map.** A sighting from a searcher on a map the leader
    is not on must still start the encounter (the old leader-map filter is not
    used for patrol sightings). **live** whenever the first spotter is not the
    leader's map.
12. **Spotter briefly loses sight.** The encounter tolerates 10 seconds without
    a fresh sighting while converging, so the spotter can re-acquire it.
13. **Phoenix moves while members converge.** Converge and shadow destinations
    follow the latest sighting, and the client re-routes when the destination
    moves far enough for the remaining trip (entry 13a).
13a. **Far members restart their route on every sighting (seen live, 10-18).**
    Written before the fix. The Phoenix (speed 50) moves 100-150 units between
    sightings, so entry 13's fixed 100-unit rule cancelled every converging
    member's route about every 2-3 seconds. A far member's new route starts with
    a town warp, and the next cancel interrupted that warp before it finished, so
    it restarted the warp over and over. Live on Mainland's west strip: one
    Phoenix, 126 s from sighting to gather, with the converge routes cancelled 53
    (priest, starting about 2,400 units away), 58 (warrior) and 81 (spotter)
    times; every stop stack was `cancelRarePath <- pollRareSearch`. A cross-map
    member can effectively never arrive. Expected: a member keeps its route while
    the Phoenix's drift is small compared with the distance still to walk
    (re-aim only past the larger of 100 units and a third of that distance; a
    member on another map re-aims only when the Phoenix changes map), and a town
    warp or transport is never interrupted while the member cannot see the
    Phoenix, for drift or for a new control (search to converge); the next poll
    after it lands re-aims. A member that sees the Phoenix abandons a warp
    rather than being carried away from it (seen in E2E runs of 8c: the spotter
    warped to town and lost the Phoenix). Ways the fix could fail:
    - The far member still restarts dozens of times, or still interrupts its warp.
    - A near member no longer tracks the Phoenix and arrives where it used to be.
    - A member on another map walks to a stale point after the Phoenix changed map.
    **live**: a fighter starting on Mainland's east spawn converges on a Phoenix
    wandering the west strip with few route restarts, and gathers in time.
14. **Converge never completes.** The deadline is the later of five minutes and
    twice the slowest member's planned travel time. After it passes, the party
    engages with whoever is in range, and the dashboard names the missing members.
15. **Outsider already fighting.** If the Phoenix has a target (another player,
    or a party member it aggroed), members in range engage immediately; the
    others keep converging.
15a. **Converging members stop once a fight starts (seen live).** Written before
    the fix. When the Phoenix already has a target, a gathered member engages, and
    its attack adds a grouped fight. `rareActive()` (upstream) turns rare control
    off during any unfinished fight unless it is an `encounter` on the fight's
    target. The `converge` and `engage` kinds were not exempt, so the members still
    converging lost their route and stood still until the fight ended. Ways the fix
    could fail:
    - Converging members still stop, or flip between walking and holding each tick.
    - A converging member attacks before it arrives, or attacks something else on
      the way. Only the Phoenix is exempt, and the existing hold-fire rule applies.
    - An arrived member keeps walking to the Phoenix's center instead of handing
      over to the role loop for range and formation.
    - The exemption leaks: a `converge`/`engage` control whose target is not the
      fight's target, or a `search` control, keeps walking during an unrelated
      grouped fight (a searcher attacked by a bee must still defend itself, entry 8).
    - The walkers arrive but never attack because the converge stage already ended.
    **live**: with the Phoenix aggroed on one fighter before anyone gathers, every
    other fighter keeps closing in while it fights, then lands its own hits.
    Result: before the fix the warrior stood still for 231 s at (836, 1196) on
    Mainland while the priest killed the Phoenix alone. After it, the warrior
    reached range 38.5 s after the aggro and hit 0.4 s later. `rareActive()` now
    also keeps a `converge`/`engage` control while every unfinished fight is on
    that control's own target.
16. **Another party kills it while we shadow.** This is an unengaged death: no
    loot, and the respawn wait starts from the death time.
17. **Encounter released by grouped-combat checks.** While converging, the
    selection-released and claim checks are skipped. They apply again after
    the party has gathered.

17a. **Patrol Phoenix permanently rejected.** Found live: the party gathered,
    grouped combat selected the Phoenix but was still settling formation, and
    the 30-second no-progress rule ended the encounter. Retry evidence then
    rejected that Phoenix until a fighter was in attack range, so every later
    sighting, including on-route ones, was dropped while fighters walked past.
    A patrol Phoenix is never rejected that way; a failed attempt only gets the
    3-second cooldown, and any existing rejection is cleared on the next sighting.
17b. **No-progress clock during formation.** After the gather, the 30-second
    no-progress clock waits until grouped combat locks the Phoenix. The
    five-minute limit from the gather still bounds the formation phase.

## After the kill

18. **Looter blocks the spread.** Only the leader keeps the loot control. Other
    fighters get search controls once grouped fights have finished, and they
    pre-position for the respawn. **live**: a non-leader fighter leaves while
    the leader's loot is still pending, or is in a different region before `readyAt`.
19. **Stale kill or restart.** `readyAt` persists in the checkpoint; restart
    rebuilds assignments and coverage instead of trusting old positions.
19a. **Realm hop ends the patrol for good.** Seen live: boss chase moved the
    fighters from US II to US V. The leader's realm no longer matched the
    patrol's, the patrol counted as superseded, and `stop()` turned it off, so
    the party idled after coming back. A realm change alone suspends the patrol
    instead: the checkpoint keeps its realm and respawn deadline, and the patrol
    resumes when the leader is back on that realm.
19b. **Patrolling the wrong realm.** While suspended, nothing may restore a
    patrol on the foreign realm; boss chase or the event there owns the party.
19c. **New navigation while away.** A revision, focus, policy, or leader change
    while suspended still stops the patrol for good, as it would at home.
20. **New navigation.** Revision checks cancel search, converge and engage
    controls exactly as before.
