# Achievement Hunt

Achievement Hunt farms monsters for their kill achievements (the permanent stat
rewards in `G.monsters[id].achievements`). It is a farming mode like Hunt
(`farmingPolicy: "achievements"`, chosen next to Auto, Default, Scatter and Hunt),
but it chooses its own targets from achievement progress instead of taking
quests from Daisy.

It only chooses *what* to farm. Travel, formation, grouped combat and
competition relocation work exactly as they do when a monster is picked by
hand, and the fight style follows Auto's logic as in Hunt (scatter where it has
been learned per monster). Each target switch goes through the same
`manual-monster-override` convoy as `navigate-to-monster`, except that it stays
in Achievement Hunt instead of resetting the mode to Auto.

## Characters

Achievement Hunt follows the same farming scopes as Hunt. The party leader's
settings drive the leader and every follower. A character with Follow off has
its own settings, blacklist and target, and travels alone. Followers can read
the leader's settings but cannot edit them; the coordinator answers
"following leader settings". The settings live in each character's Farming
settings dialog, next to Hunt settings.

## Choosing targets

- **Selection.** The player selects monsters from a list sorted weakest to
  strongest by XP per kill, which the game scales with HP, damage and
  defenses. Ties are broken by bestiary threat (`attack × frequency`), then
  HP. Threat alone misranks monsters: a Vampire Rat hits harder than a Fire
  Spirit but has a ninth of its HP.
- **Two lists.** Regular monsters are those with a fixed map spawn. Special
  monsters (bosses, event, cooperative and random-respawn monsters, and those
  the game leaves out of its monster list: the training dummies and the Cave of
  Many Dreams monsters) are listed separately and are never selected by default.
- **Steps.** Every monster has its own milestone ladder, for example
  `10, 100, 1000…` or `1, 100, 1000…`. Step *n* is the *n*-th milestone of
  each monster's own ladder.
- **The target.** It is the first selected monster, weakest first, whose next
  unmet milestone is at the lowest step. So every selected monster reaches step
  1 before any is farmed for step 2, and so on.
- **Kills.** Kill counts are the account-wide progress the clients already
  report (`monsterAchievementKills`); the largest value across party statuses
  is used.
- **Moving on.** When the target's kill count reaches its milestone, the next
  target is chosen.

## Skipping and blacklisting

Skipping works like Hunt's blacklist:

- **Manual skips.** Monsters are left unselected, or added to the
  Achievement Hunt blacklist by hand.
- **Deaths.** When *Blacklist on deaths* is on, a target is blacklisted after
  `deathThreshold` party deaths while farming it.
- **Removing entries.** Blacklist entries are removed individually or cleared.

## Failure modes considered before implementation

1. **Fighting the player.** If the player changes the monster focus while
   Achievement Hunt is running, re-selecting the target would undo their choice
   every tick. Instead the mode switches to Auto, as picking a monster by hand
   does, and reports why.
2. **Thrashing.** Kill counts arrive from several clients and can lag. A target
   switch happens only when the current target's milestone is met, when it is
   blacklisted or unselected, or when a monster at a lower step becomes
   available again (re-selected, unblacklisted, or a route retry). Counts only
   rise, so small count differences never cause a switch.
3. **Conflicting owners.** A daily dungeon, an event trip, a rare hunt or
   another convoy may own travel. Achievement Hunt must not start a convoy then;
   it waits. Hunt is a different farming mode, so the two never run together;
   choosing another mode forgets the target.
4. **Offline owner.** With no fresh report from the scope's owner (the party
   leader, or the independent character) there is nothing to move. It waits.
5. **No route.** A selected monster may have no known spawn. It is skipped
   with a reason, not retried every tick.
6. **Everything done or skipped.** The party keeps farming the last target.
   The status says nothing is left to farm, instead of clearing focus and
   stranding the party.
7. **Death counting.** A death recorded before the target started, or one
   reported twice by the same client, must not count. Only `lastDeath.at`
   values newer than the target's start count, at most once per timestamp per
   character.
8. **Restart.** Settings, blacklist and current target persist with the other
   farming settings, so a restart resumes the same target instead of starting
   over.
9. **Staying in the mode.** A target switch must keep the farming mode on
   Achievement Hunt (picking a monster by hand resets it to Auto). Only the
   learned scatter state for the old monster resets, as on any focus change.
10. **Monsters with no achievements, or finished ladders.** They are never
    targets, and listing them is harmless.
11. **Scopes crossing.** An independent character's target switch must move
    only that character and must not touch the party's mode, focus or
    target. Its tick runs on its own scope view with itself as the only
    member.
12. **Upgrading a saved console.** Settings saved before scopes existed sit
    on the party state. The leader's profile picks them up on load, so an
    existing selection survives the upgrade.
