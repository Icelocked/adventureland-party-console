# Questions for Ryan

These are questions about how you meant the console to behave, collected while I mapped
your 1.5-feature-branch (b9b5c91e) and my fork side by side. Each answer can be a
plain yes or no, or "here's why it works this way". Anything you disagree with changes
the plan.

Line numbers are on b9b5c91e. Where my fork patched the same spot, the question says so,
because my patches have the same problems as the rest (pull mode needed 8 fixes in two days, Achievement Hunt 21).

The questions are ordered by how much each answer affects: how many recurring issues or
how much play time sits behind it.

## 1. When two tasks want the party, which one wins?

**Today:** each part checks the others in its own order. Hunt's tick, for example,
checks rare control before the event pause (runtime/coordinator/hunt/tick.ts:88-92), and
other parts keep their own lists of who to wait for.

**What I'd suggest:** one written order that every part reads: escape, death recovery,
dungeon visit, Hunt turn-in, event return, event attendance, rare, Hunt mission, then
farm-area moves (fork add-ons go below Hunt missions). Most of the flags and timers added
between parts exist to settle this order case by case.

**Your answer:**

## 2. Who may stop a journey it did not start?

**Today:** any `stop()` ends the current journey and records it as "Unattributed
movement stop" (runtime/characters/movement.ts:411). There are 102 stop calls.

**What I'd suggest:** only the journey's owner, plus escape and death recovery. Town
would then ask for movement like any other part instead of stopping everyone.

**Your answer:**

## 3. Should asking for the same destination twice restart the walk?

**Today:** every new request ends the live journey, stops the character and plans again,
even for the same place (runtime/characters/movement.ts:384). Callers add their own
guards against asking twice; my fork added a move cap on top.

**What I'd suggest:** keep the live journey when the same owner asks for the same place.
A caller that wants a fresh route asks for one by name.

**Your answer:**

## 4. Was `pause()` meant for combat steps during travel?

**Today:** combat sends its own steps while a journey is live, and the movement service
repairs or rejoins the route afterwards. `pause()` exists for this hand-off, but no
combat mover calls it (runtime/characters/movement-executor.ts:28-36).

**What I'd suggest:** combat pauses the journey and resumes it after the fight. Route
repair then becomes a rare fallback instead of the normal path.

**Your answer:**

## 5. Should combat steps avoid monsters that are not attacking yet?

**Today:** the step check used by kiting, approach and farm search looks only at monsters
already targeting the character (characters/shared.js:17167-17169). The formation solver
checks every visible monster. My fork added a separate idle check for pull mode only.

**What I'd suggest:** every step stays out of idle monsters' aggro reach, once the reach
is confirmed from the game source. Several of the deaths I traced started with a step
next to an idle monster.

**Your answer:**

## 6. Where is "safe" after an escape or a death?

**Today:** the coordinated escape in party-escape.cjs ends at the Blink landing, while
death recovery waits for every member on Main within 65 of (0, 0)
(scripts/combat-disengagement.cjs:83-92). When the landing is not
Main, the party waits there and Hunt does not resume. My fork added a walk to Main as a
patch, which leaves two definitions of "safe".

**What I'd suggest:** one goal shared by escape and death recovery: Main Town. The
respawn point is there, so dead members end up there anyway.

**Your answer:**

## 7. Should a due heal always take the priest's attack slot?

**Today:** the attack controller decides 2 ms before the cooldown ends and asks
`can_heal`, which is still false at that moment (characters/shared.js:17701). On my fork's test farm, 127 of 127 priest attacks while a
member was under 90% HP went out this way.

**What I'd suggest:** yes, a due heal wins the slot whenever a member is under the heal
threshold. My fix checks heal range instead of `can_heal` and ticks 1 ms after the
cooldown (648b3be0); happy to send it as an issue if the intent matches.

**Your answer:**

## 8. Was removing the basic-attack MP reserve intended?

**Today:** b03f0855 added a rule that skipped basic attacks below the class survival MP
floor. b989128a ("Resolve PR integration in favor of latest workspace code") removed it
three days later. Now only skills keep the reserve
(runtime/characters/skills/eligibility.ts:75-80).

**What I'd suggest:** if the removal was a side effect of the merge, restore the floor
for the priest at least, so heals keep their MP.

**Your answer:**

## 9. Which classes should drink HP potions, and when may regen run?

**Today:** only the priest and mage drink HP potions in combat, below 50%
(runtime/characters/classes/priest.ts:20-22); warrior, paladin, ranger and rogue have
none. When no potion is drunk the loop casts regen at any missing HP
(runtime/characters/roles/runner.ts:259), and regen locks every potion for 4 s.

**What I'd suggest:** one potion table for every fighter, and regen only when no potion
threshold would trigger within those 4 s. I traced a tank dying with potions in the bag
to this pair.

**Your answer:**

## 10. Should a manual move during an event leave the event for good?

**Today:** any manual command marks the live occurrence as skipped for that character
(runtime/coordinator/navigation/manual-commands.ts:79, then
runtime/coordinator/events/attendance-limits.ts:166-168). A bestiary pick does the same
for every member.

**What I'd suggest:** only a move whose destination leaves the event map skips the
event, plus a "rejoin" button that clears the skip.

**Your answer:**

## 11. How early should the party stage for a walk event, and should staging pause Hunt?

**Today:** staging opens 120 s before spawn for every walk event
(characters/shared.js:11532), and every Hunt check for "at an event" fires from that
moment, so Hunt pauses and cancels its convoy.

**What I'd suggest:** a lead based on the planned route time plus a margin, and Hunt
keeps going until the walk actually starts.

**Your answer:**

## 12. After a Cave visit ends, should the party release on its own?

**Today:** the visit sits in `held` until someone presses Release
(runtime/coordinator/dungeons/service.ts:263-274). While held, escape and death recovery
do not run (runtime/coordinator/application.ts:1741-1742), and a member who dies outside
the Cave does not respawn.

**What I'd suggest:** release on its own once every participant is outside and nothing
is pending, and keep escape and death recovery on outside the Cave.

**Your answer:**

## 13. When several parts hold a character, who writes the "what is it doing" line?

**Today:** each part writes free text next to its own state; Hunt alone has 54 message
writes and 38 stage writes in runtime/coordinator/hunt/ (for example
runtime/coordinator/hunt/tick.ts:59). The card has no single "doing now" line, and
convoy progress is not shown. My fork's name strip rebuilds one sentence from about a
dozen parts' fields and parses message prefixes, which is the same problem one layer up.

**What I'd suggest:** each part publishes a small `{phase, label, since}` per character
through one status registration, and the dashboard shows the highest-priority label. Each
part then has one place to change its text, and convoys get a label for free.

**Your answer:**

## 14. How much should the 250 ms fallback poll send while the live stream is down?

**Today:** with the default `PARTY_STATE_FIELDS=shadow`, the fast poll sends every
stored field except seven (runtime/coordinator/telemetry/character-fields.ts:252-255),
including the combat trace, which the field registry sizes at about 146 KB per character
(:191). It runs every 250 ms whenever the stream is down or not yet healthy. From the
registry sizes, four characters send about 2.3 MB/s in that state (an estimate, not a
measurement).

**What I'd suggest:** default to `enforce`, which sends only the whitelist your
registry test already checks against the dashboard's reads. I would first confirm the
PWA reads only whitelisted fields.

**Your answer:**

## 15. Should one call budget decide which calls wait?

**Today:** the only check of `character.cc` is a fighter's wait before sending items
(characters/shared.js:5719-5720). Background reads run on timers wherever the merchant
is: Ponty every 10 s at cost 17, players every 10 s at cost 13. Thirteen Ponty reads in
one window cost 221 against the 200 limit, which disconnects the socket. My fork added
two separate limiters that do not count each other's calls.

**What I'd suggest:** one budget with priorities: survival and combat first, job steps
next, background reads last. The Ponty read runs only near Ponty.

**Your answer:**

## 16. Should Witch's Cipher default `minClues` to 0?

**Today:** `minClues` defaults to 1 (runtime/events/october.ts:27), and the check runs
before the solver and the affordability branch. The solver works with zero clues, so on
an empty realm board the merchant waits "for clues" for the whole event.

**What I'd suggest:** default to 0 and move the check after affordability.

**Your answer:**

## 17. When a job interrupts gathering, should the merchant's hands be restored?

**Today:** the hand-off cancels the gathering attempt and returns without re-equipping
(characters/shared.js:9994-10008), so the merchant walks to the job holding the rod or
pickaxe with no offhand. My fork restores the mainhand for `merchant-` commands only,
which covers one case.

**What I'd suggest:** restore both hands before any command other than gathering, and
defer the command if the restore fails. Equip and unequip cost about 6 and 9 calls.

**Your answer:**

## 18. Which realms may the merchant hop to for a job?

**Today:** the job realm route accepts any realm for a listed job, PVP realms included,
with no check of the realm hop blacklist
(runtime/coordinator/http/merchant-realms.ts:39-68). Each job hops there and back on its
own.

**What I'd suggest:** keep your cross-realm buying, but refuse PVP and blacklisted
realms, group ready jobs by realm, and return home once per group.

**Your answer:**

## 19. Should the native loader own its socket listeners the way headless workers do?

**Today:** shared.js adds its socket listeners directly (characters/shared.js:879-884),
and the loader only calls `stop` while the frame is still attached
(runtime/characters/universal-loader.ts:135). A frame detached any other way leaves 7
handlers that the text search does not know. I think this is why the Steam client
throws every few seconds after a console restart until it is restarted.

**What I'd suggest:** reuse your `RunnerScope` approach for the native path, so dispose
removes every listener whatever the frame state.

**Your answer:**

## 20. Should live progress (the Hunt line, farm zone notice) refresh every second?

**Today:** these lines read `farmingProfiles`, which sits in the config section polled
every 15 s (runtime/coordinator/telemetry/public-state.ts:77). The leader's Hunt in the
core section is 1 s old, but the line reads the profile copy, so it can lag 15 s behind.
The config test's name says "without slowing live progress", so I think this is not
the intent.

**What I'd suggest:** core carries each profile's live phase fields, and config keeps
only settings.

**Your answer:**

## Smaller questions

One line each; line numbers on b9b5c91e.

- **S1.** A timed-out walk keeps walking after its deadline (characters/shared.js:11802-11822): should the deadline stop it?
- **S2.** Franky approaches check terrain only (characters/shared.js:17253-17255): would step safety, with the boss excluded, get in the way?
- **S3.** A blocked mage escort in an event waits with no detour (characters/shared.js:16921-16926): should it fall back to the event approach detour?
- **S4.** An event walk replaces any convoy, including a Hunt trip halfway there (runtime/coordinator/navigation/shared-walk.ts:191): always, or only for short-window bosses?
- **S5.** Walks follow three moving bosses (navigation/event-pursuit.ts:24) while five more only share a fixed point (shared-walk.ts:60): is the shorter list on purpose?
- **S6.** An event walk starts after 20 s without members who have not asked (shared-walk.ts:45): should a fighter walk ever start without the healer?
- **S7.** Any leader drift over 1 unit re-plans the departure (navigation/shared-route-store.ts:93): would planning from where the leader stands work?
- **S8.** After three failed regroup routes new pulls wait until the group changes (characters/shared.js:14662-14663): should the separated member go to the farm point instead?
- **S9.** "Home" is 65 for escape, 90 for Town and event return, 100 for anniversary, and the manual Town walk parks 212 from (0, 0) (manual-commands.ts:114): are the different radii on purpose?
- **S10.** While Town casts, a 100 ms watchdog stops every move (characters/shared.js:11062-11099): is "nothing else moves" the intent?
- **S11.** Three lists of travel a rare may interrupt disagree on `party-travel` and `empty-spawn-recovery` (navigation/rare-hunting.ts:124-131, 181, 841): which is right?
- **S12.** A failed rare encounter or loot walk is never retried (characters/shared.js:3688): would one retry fit?
- **S13.** A farming-mode change cancels a live rare and its return: finish the rare first?
- **S14.** After a rare the party returns to the saved farm or Hunt mission and keeps offline members: is that the intent?
- **S15.** During a rare, scatter is forced to grouped without a direct restore: should scatter come back right after?
- **S16.** Stomp, Dash, Energize, Curse and partyheal keep their own MP floors outside the skill engine (runtime/characters/classes/warrior-combat.ts:11): should they use the engine's reserve?
- **S17.** Agitate is listed in three gates but nothing casts it (runtime/characters/skills/eligibility.ts:73): drop it, or is a caster planned?
- **S18.** The priest MP checks compare with `G.skills.heal.mp`, which game data does not have (characters/shared.js:17697): was `mp_cost` meant?
- **S19.** Escape drinks MP first and the mage never drinks HP while escaping (characters/shared.js:71-72): is MP-first on purpose?
- **S20.** A death ends the fight unless foes are at or below 25% and survivors at or above 50% (scripts/combat-disengagement.cjs:77-82): are these the thresholds you want?
- **S21.** The coordinated escape needs exactly one warrior, mage and priest (scripts/party-escape.cjs:28-41): should another Blink or teleport class lead it?
- **S22.** A passing monster that hits the party counts as a threat only on return trips (characters/shared.js:14003-14005): is that the intent outside return trips too?
- **S23.** Aggro skills belong to the leader only (runtime/characters/skills/eligibility.ts:72-74): is that tied to the leader on purpose, or to whoever tanks?
- **S24.** Magical basic attacks are blocked only for slenderman, tiger and goblin (runtime/characters/roles/monster-attack-policy.ts:3), while game data lists reflection on eight monsters: was the list meant to cover all of them?
- **S25.** A rejected event `join` is retried every 10 s (characters/shared.js:13418-13421): should it back off, or skip when the join window has closed?
- **S26.** With two live events, sessions are keyed by character (events/observations.ts:138-144): attend only the top event, or may the party split?
- **S27.** A higher-ranked combat event interrupts anniversary staging and featured holds but never an active kiss (characters/shared.js:13311-13331): should a featured hold be protected too?
- **S28.** When several parts hold Hunt, the first check in call order writes the message: should the highest-priority holder's text win?
- **S29.** A solo character's open event trip is read from party-wide state (hunt/mode.ts:55-58): should it ever hold the party?
- **S30.** During A/B testing a follower stops following a leader on the other team: keep, or follow a same-team member?
- **S31.** Saved Hunt cycles can hold stages with no production writer (`failed-return`, temporary encounters, exit mode): drop them after one converting release?
- **S32.** A drifting leader can restart Hunt travel without a limit: count drift resets and stop after N?
- **S33.** A quest monster is blacklisted after one party death (hunt/settings.ts:13): is 1 the default you want?
- **S34.** Learned scatter types reset on every coordinator restart (navigation/initial-farming.ts:48-49): save them per roster?
- **S35.** A geometry-mismatch farm travel failure pauses farming with no retry (farm-area-recovery.ts:97-99): retry once first?
- **S36.** Competition relocation outside Hunt is always on for shaped areas (farm-competition.ts:74): should it have its own setting?
- **S37.** An offline Cave participant blocks Release for the rest (dungeons/service.ts:267-271): release the online members?
- **S38.** With event protection off, a live event exits the Cave visit at once, mid-encounter included (dungeons/service.ts:250-252): exit only between encounters?
- **S39.** Cave travel stops after three repairs with no error of its own (dungeons/travel.ts:142): show which repair ran out?
- **S40.** Gathering stops at 3 free slots but its deposit step needs fewer than 3 (characters/shared.js:10028, 10054): should a full bag queue a bank job?
- **S41.** A giveaway the merchant found itself has no expiry (merchant/dispatcher.ts:246): expire it at the giveaway's end time?
- **S42.** A running gathering cast finishes before an incoming job (characters/shared.js:9994-10008): is the short wait intended for every job?
- **S43.** A failed party realm switch leaves moved workers on the new realm (characters/realm-switch.ts:294-302): retry stragglers once, then roll back?
- **S44.** The stand uses 16 slots everywhere (merchant/automatic-sales.ts:88), while the game gives 24 at level 70 or with a `cstand` and 30 at level 80: read it from the game rule?
- **S45.** A native WTB offer whose slot empties without a receipt stays blocked (commerce/native-stand.ts:76-79): drop it after a confirmation window?
- **S46.** Mail with an item costs 360000 gold and is sent without a gold check (characters/shared.js:10326-10380): withdraw postage first?
- **S47.** Your bid jobs spend with no gold reserve (commerce/bids.ts:93-103): would a reserve setting defaulting to 0 suit you?
- **S48.** Settings changes leave no record of the previous value or source (http/formation.ts:90-111): log one line per change?
- **S49.** The dashboard shows defaults until the config domain loads (dashboard use-party-console.tsx:163-164): show "loading" instead?
- **S50.** Import accepts values the route refuses, such as `itemCollectionThreshold` 50 (persistence/dashboard-import.ts:60 vs http/thresholds.ts:32): use the route's bounds?
- **S51.** 19 scoped fields are saved twice for rollback to v1.4.0: drop the top-level copies after a migration?
- **S52.** Workers get 500 ms before SIGKILL at shutdown (characters/processes.ts:27): should shutdown wait for `canReload` like a safe reload?
- **S53.** Tests cut functions out of shared.js, which needs 85 `typeof` guards in production (my fork added 27 more): would loading shared.js whole in tests suit you?
- **S54.** If one field in a settings request is invalid, `formation` has already written the leader and follow flags before it returns 400 (runtime/coordinator/http/formation.ts:96-99): should it check every field first and change nothing on an error?
- **S55.** One member report older than 3 s stops the whole convoy (runtime/coordinator/navigation/travel-defense.ts:25-32), and a test says this is intended: could it keep walking through short gaps unless an attacker is known?
- **S56.** Luck the merchant casts on its own owner's characters is "strong", and the scheduler skips every strong buff (runtime/coordinator/merchant/luck-scheduler.ts:36-41), so the party's fighters are refreshed only after expiry: refresh them on the normal lead time?
- **S57.** Every heartbeat sends up to 160 combat trace and 256 handoff timing entries (characters/shared.js:2910, 3065), and no dashboard view reads them: send them only while a diagnostics viewer holds a lease, like map telemetry?
- **S58.** The dashboard keeps its own copies of runtime rules (stand full, Cave entry, reserved bag slots, priority ranges, the farming owner, prices), and two have drifted: should each owner publish the answer the dashboard needs?
- **S59.** With cards on screen, nothing renders the computed connection state (dashboard/features/party/dashboard-health.tsx:12-23), so a stopped coordinator leaves stale numbers with no sign: render `DashboardHealth` in the header?
- **S60.** When two Hunt pause reasons apply, the event pause wins because the tick checks it first (runtime/coordinator/hunt/tick.ts:92), hiding "select Hunt again": should a reason that needs a click win over one that clears itself?
- **S61.** Convoy messages go to the merchant activity log (runtime/coordinator/application.ts:416, 1801): show them on the card instead?
- **S62.** Game logs live only in memory (telemetry/game-logs.ts:3) while combat logs persist: is memory-only intended, and should the panel say so?
- **S63.** "Online" uses five windows on the page (5, 8, 10, 10 and 15 s): could every element read one connection state per character?
- **S64.** Only the dashboard forbids a follower routing itself to a monster (dashboard/lib/party-routing.ts:12-14); the runtime accepts it from any client: enforce it in the runtime?
- **S65.** A merchant marked as a follower shows the leader's farming settings on its card (farming-context.ts:4-6) while the runtime uses its own: should the merchant be refused as a follower?
- **S66.** Stand-full is `standIsFull` in one dialog and a plain 16-listing count in five others: should the coordinator publish free stand slots?
- **S67.** The merchant card shows fishing and mining rows from its own 3-slot rule though the runtime never queued them (merchant-card-controls.tsx:101-150): should the runtime publish gathering readiness?
- **S68.** Hunt preparation shows priority boxes with a no-op handler (party-workspace.tsx:102-108): hide them?
- **S69.** Make WTB and Add to WTB store the listing price and then drop it (wtborder-dialog.tsx:64): prefill it?
- **S70.** A player's own automatic NPC sale rules are not listed anywhere: show them on the merchant card with the owner's name?
- **S71.** The header account total counts offline gold on the coordinator (account-gold.ts:3-8) but not in the dashboard fallback (party-gold.tsx:19-20): count it in both?
- **S72.** Without `monster_stats`, the character adds up Tracktrix rewards itself (characters/shared.js:2083-2096): mark the number as calculated?
- **S73.** The elixir shows in Active status and on the Equipped tile with two timers: drive both from one clock?
- **S74.** The Kills game log filter starts off (runtime/game-log-filters.ts:4): is off the default you want?
- **S75.** Metrics history older than 180 days drops out of the kill total (metrics/service.ts:259): label it, or add a lifetime counter?
- **S76.** Loot "today" uses America/Toronto midnight (metrics-days.ts:1) while kills and DPS use the browser's: was the fixed zone on purpose?
