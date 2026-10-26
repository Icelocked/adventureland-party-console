# Open questions

Questions about how the current console is meant to behave. Each has what I'd
suggest in one line; a yes, no or "here's why" is plenty. The full context for
each (how it works today, with file and line on b9b5c91e) is in
[QUESTIONS-DETAILS.md](QUESTIONS-DETAILS.md) under the same number.

## 1. When two tasks want the party, which one wins?

**Suggestion:** one written order that every part reads: escape, death recovery, dungeon visit, Hunt turn-in, event return, event attendance, rare, Hunt mission, then farm-area moves (fork add-ons go below Hunt missions).

**Your answer:**

## 2. Who may stop a journey it did not start?

**Suggestion:** only the journey's owner, plus escape and death recovery.

**Your answer:**

## 3. Should asking for the same destination twice restart the walk?

**Suggestion:** keep the live journey when the same owner asks for the same place.

**Your answer:**

## 4. Was `pause()` meant for combat steps during travel?

**Suggestion:** combat pauses the journey and resumes it after the fight.

**Your answer:**

## 5. Should combat steps avoid monsters that are not attacking yet?

**Suggestion:** every step stays out of idle monsters' aggro reach, once the reach is confirmed from the game source.

**Your answer:**

## 6. Where is "safe" after an escape or a death?

**Suggestion:** one goal shared by escape and death recovery: Main Town.

**Your answer:**

## 7. Should a due heal always take the priest's attack slot?

**Suggestion:** yes, a due heal wins the slot whenever a member is under the heal threshold.

**Your answer:**

## 8. Was removing the basic-attack MP reserve intended?

**Suggestion:** if the removal was a side effect of the merge, restore the floor for the priest at least, so heals keep their MP.

**Your answer:**

## 9. Which classes should drink HP potions, and when may regen run?

**Suggestion:** one potion table for every fighter, and regen only when no potion threshold would trigger within those 4 s.

**Your answer:**

## 10. Should a manual move during an event leave the event for good?

**Suggestion:** only a move whose destination leaves the event map skips the event, plus a "rejoin" button that clears the skip.

**Your answer:**

## 11. How early should the party stage for a walk event, and should staging pause Hunt?

**Suggestion:** a lead based on the planned route time plus a margin, and Hunt keeps going until the walk actually starts.

**Your answer:**

## 12. After a Cave visit ends, should the party release on its own?

**Suggestion:** release on its own once every participant is outside and nothing is pending, and keep escape and death recovery on outside the Cave.

**Your answer:**

## 13. When several parts hold a character, who writes the "what is it doing" line?

**Suggestion:** each part publishes a small `{phase, label, since}` per character through one status registration, and the dashboard shows the highest-priority label.

**Your answer:**

## 14. How much should the 250 ms fallback poll send while the live stream is down?

**Suggestion:** default to `enforce`, which sends only the whitelist.

**Your answer:**

## 15. Should one call budget decide which calls wait?

**Suggestion:** one budget with priorities: survival and combat first, job steps next, background reads last.

**Your answer:**

## 16. Should Witch's Cipher default `minClues` to 0?

**Suggestion:** default to 0 and move the check after affordability.

**Your answer:**

## 17. When a job interrupts gathering, should the merchant's hands be restored?

**Suggestion:** restore both hands before any command other than gathering, and defer the command if the restore fails.

**Your answer:**

## 18. Which realms may the merchant hop to for a job?

**Suggestion:** keep your cross-realm buying, but refuse PVP and blacklisted realms, group ready jobs by realm, and return home once per group.

**Your answer:**

## 19. Should the native loader own its socket listeners the way headless workers do?

**Suggestion:** reuse your `RunnerScope` approach for the native path, so dispose removes every listener whatever the frame state.

**Your answer:**

## 20. Should live progress (the Hunt line) refresh every second?

**Suggestion:** core carries each profile's live phase fields, and config keeps only settings.

**Your answer:**

## Smaller questions

One line each; details in QUESTIONS-DETAILS.md.

- **S1.** `anniversaryWithTimeout` rejects at its deadline but leaves the walk running, and escape's walk to Main has no stop after it: should the deadline stop the walk?
- **S2.** Franky approaches check terrain only: would step safety, with the boss excluded, get in the way?
- **S3.** A blocked mage escort in an event waits with no detour: should it fall back to the event approach detour?
- **S4.** An event walk replaces any ordinary convoy, including a Hunt trip halfway there; only Hunt returns, manual walks and other shared walks are protected: always, or only for short-window bosses?
- **S5.** Walks follow three moving bosses while five more only share a fixed point: is the shorter list on purpose?
- **S6.** An event walk starts after 20 s without members who have not asked: should a fighter walk ever start without the healer?
- **S7.** Any leader drift over 1 unit re-plans the departure: would planning from where the leader stands work?
- **S8.** After three failed regroup routes new pulls wait until the group changes: should the separated member go to the farm point instead?
- **S9.** "Home" is 65 for escape, 90 for Town and event return, 100 for anniversary, and the manual Town walk parks 212 from (0, 0): are the different radii on purpose?
- **S10.** While Town casts, a 100 ms watchdog stops every move: is "nothing else moves" the intent?
- **S11.** Three lists of travel a rare may interrupt disagree on `party-travel` and `empty-spawn-recovery`: which is right?
- **S12.** A failed rare encounter or loot walk is never retried: would one retry fit?
- **S13.** A farming-mode change cancels a live rare and its return: finish the rare first?
- **S14.** After a rare the party returns to the saved farm or Hunt mission and keeps offline members: is that the intent?
- **S15.** During a rare and its return to the farm, scatter is forced to grouped, so scatter comes back only once that return ends: should it come back as soon as the rare dies?
- **S16.** Stomp (25%), Dash (50%), Energize (35%) and Curse (50%) keep their own MP floors outside the skill engine, and partyheal casts with no floor: should they use the engine's reserve?
- **S17.** Agitate is listed in three gates but nothing casts it: drop it, or is a caster planned?
- **S18.** The priest MP checks compare with `G.skills.heal.mp`, which game data does not have: was `mp_cost` meant?
- **S19.** Escape drinks MP first and the mage never drinks HP while escaping: is MP-first on purpose?
- **S20.** A death ends the fight unless foes are at or below 25% and survivors at or above 50%: are these the thresholds you want?
- **S21.** The coordinated escape needs exactly one warrior, mage and priest: should another Blink or teleport class lead it?
- **S22.** A passing monster that hits the party counts as a threat only on return trips: is that the intent outside return trips too?
- **S23.** Aggro skills belong to the leader only: is that tied to the leader on purpose, or to whoever tanks?
- **S24.** Magical basic attacks are blocked only for slenderman, tiger and goblin, while game data lists reflection on eight monsters: was the list meant to cover all of them?
- **S25.** A rejected event `join` is retried every 10 s: the game answers `cant_join` when the event's server flag is off, so should it skip at once on `cant_join` and `join_too_late`, and back off only on `cant_when_sick` or `cant_in_bank`?
- **S26.** (Dropped: each member's event priority list already decides which live event it attends, and followers use the leader's list.)
- **S27.** (Dropped: the event priority list already decides whether anniversary staging yields to another event.)
- **S28.** When several parts hold Hunt, the first check in call order writes the message: should the highest-priority holder's text win?
- **S29.** Hunt event trips are stored root-wide, and the party's combat event handoff stays open while any character's trip is open: should a solo character's trip ever hold the party?
- **S30.** During A/B testing a follower stops following a leader on the other team: keep, or follow a same-team member?
- **S31.** Saved Hunt cycles can hold records with no production writer (stage `failed-return`, temporary encounters, `exitMode`), read for example at hunt/tick.ts:83: drop them after one converting release?
- **S32.** A drifting leader can restart Hunt travel without a limit: count drift resets and stop after N?
- **S33.** A quest monster is blacklisted after one party death: is 1 the default you want?
- **S34.** Learned scatter types reset on every coordinator restart: save them per roster?
- **S35.** A geometry-mismatch farm travel failure pauses farming with no retry: retry once first?
- **S36.** Competition relocation outside Hunt is always on for shaped areas: should it have its own setting?
- **S37.** An offline Cave participant blocks Release for the rest: release the online members?
- **S38.** With event protection off, a live event exits the Cave visit at once, mid-encounter included: exit only between encounters?
- **S39.** Cave travel stops after three repairs with no error of its own: show which repair ran out?
- **S40.** Gathering stops at 3 free slots but its deposit step needs fewer than 3: should a full bag queue a bank job?
- **S41.** A giveaway the merchant found itself has no expiry: expire it at the giveaway's end time?
- **S42.** A running gathering cast finishes before an incoming job: is the short wait intended for every job?
- **S43.** A failed party realm switch leaves moved workers on the new realm: retry stragglers once, then roll back?
- **S44.** The stand uses 16 slots everywhere, while the game gives 24 at level 70 or with a `cstand` and 30 at level 80: read it from the game rule?
- **S45.** A native WTB offer whose slot empties without a receipt stays blocked, because only offers without a native id are retried: drop it after a confirmation window?
- **S46.** Mail with an item costs 360000 gold and is sent without a gold check: withdraw postage first?
- **S47.** Your bid jobs spend with no gold reserve: would a reserve setting defaulting to 0 suit you?
- **S48.** Settings changes leave no record of the previous value or source: log one line per change?
- **S49.** The dashboard shows defaults until the config domain loads: show "loading" instead?
- **S50.** Import accepts values the route refuses, such as `itemCollectionThreshold` 50: use the route's bounds?
- **S51.** 19 scoped fields are saved twice for rollback to v1.4.0: drop the top-level copies after a migration?
- **S52.** Workers get 500 ms before SIGKILL at shutdown: should shutdown wait for `canReload` like a safe reload?
- **S53.** Many tests load single functions from shared.js, and shared.js carries 85 `typeof` guards so those functions run on their own (my fork added 27 more): would a test loader for the whole file suit you?
- **S54.** If one field in a settings request is invalid, `formation` has already written the leader and follow flags before it returns 400: should it check every field first and change nothing on an error?
- **S55.** One member report older than 3 s stops the whole convoy, and a test says this is intended: could it keep walking through short gaps unless an attacker is known?
- **S56.** Luck the merchant casts on its own owner's characters is "strong", and the scheduler skips every strong buff, so the party's fighters are refreshed only after expiry: refresh them on the normal lead time?
- **S57.** Every heartbeat sends up to 160 combat trace and 256 handoff timing entries, and no dashboard view reads them: send them only while a diagnostics viewer is subscribed, the way map telemetry is?
- **S58.** The dashboard keeps its own copies of runtime rules (stand full, Cave entry, reserved bag slots, priority ranges, the farming owner, prices), and some have drifted, such as the merchant follower case and the stand-full count: should each owner publish the answer the dashboard needs?
- **S59.** With cards on screen, nothing renders the computed connection state, so a stopped coordinator leaves stale numbers with no sign: render `DashboardHealth` in the header?
- **S60.** When two Hunt pause reasons apply, the event pause wins because the tick checks it first, hiding "select Hunt again": should a reason that needs a click win over one that clears itself?
- **S61.** Convoy messages go to the merchant activity log: show them on the card instead?
- **S62.** Game logs live only in memory while combat logs persist: is memory-only intended, and should the panel say so?
- **S63.** "Online" uses several freshness windows across the page and the coordinator (5, 8 and 15 s, and 10 s in more than one place): could every element read one connection state per character?
- **S64.** Only the dashboard forbids a follower routing itself to a monster; the runtime accepts it from any client: enforce it in the runtime?
- **S65.** A merchant marked as a follower shows the leader's farming settings on its card while the runtime uses its own: should the merchant be refused as a follower?
- **S66.** Stand-full is `standIsFull` in three places and a plain 16-listing count in five others: should the coordinator publish free stand slots?
- **S67.** The merchant card shows fishing and mining rows from its own 3-slot rule though the runtime never queued them: should the runtime publish gathering readiness?
- **S68.** Hunt preparation shows priority boxes that don't change anything yet: hide them until they do?
- **S69.** Make WTB and Add to WTB store the listing price and then drop it: prefill it?
- **S70.** A player's own automatic NPC sale rules are not listed anywhere: show them on the merchant card with the owner's name?
- **S71.** The header account total counts offline gold on the coordinator but not in the dashboard fallback: count it in both?
- **S72.** Without `monster_stats`, the character adds up Tracktrix rewards itself: mark the number as calculated?
- **S73.** The elixir shows in Active status and on the Equipped tile with two timers: drive both from one clock?
- **S74.** The Kills game log filter starts off: is off the default you want?
- **S75.** Metrics history older than 180 days drops out of the kill total: label it, or add a lifetime counter?
- **S76.** Loot "today" uses America/Toronto midnight while kills and DPS use the browser's: was the fixed zone on purpose?
- **S77.** Each merchant command deposits all gold above its gold target on its first bank visit, and the target is 0 unless set on the merchant card, so the next job that spends gold starts with another bank visit; with the stand open, stand funding deposits and withdraws in a loop: would a default working gold target for the merchant fit your intent?
