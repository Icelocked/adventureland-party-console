# Achievement Hunt

Achievement Hunt farms monsters for their kill achievements (the permanent stat
rewards in `G.monsters[id].achievements`). It works like Hunt mode, but it chooses
its own targets from achievement progress instead of taking quests from Daisy.

It only chooses *what* to farm. Travel, formation, grouped combat, competition
relocation and the fight style (Auto, Default or Scatter in `farmingPolicy`)
work exactly as they do when a monster is picked by hand. Each target switch goes
through the same `manual-monster-override` convoy as `navigate-to-monster`,
except that it keeps the fight style instead of resetting it to Auto.

## Choosing targets

- **Selection.** The player selects monsters from a list sorted weakest to
  strongest (bestiary threat, `attack × frequency`, then HP).
- **Two lists.** Regular monsters are those with a fixed map spawn. Special
  monsters (bosses, event, cooperative and random-respawn monsters) are listed
  separately and are never selected by default.
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

1. **Fighting the player.** If the player picks another monster or changes
   focus while Achievement Hunt is running, re-selecting the target would undo
   their choice every tick. Instead, Achievement Hunt pauses and reports why.
2. **Thrashing.** Kill counts arrive from several clients and can lag. A target
   switch happens only when the current target's milestone is met, or when it is
   blacklisted or unselected, never because of small count differences.
3. **Conflicting owners.** Hunt mode, daily dungeons, an event trip, a rare hunt
   or another convoy may own travel. Achievement Hunt must not start a convoy
   then; it waits. It cannot be enabled while Hunt mode is on, and choosing Hunt
   turns it off.
4. **Offline leader.** With no fresh leader report there is no party to move.
   It waits.
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
9. **Fight style.** Switching targets must keep Auto, Default or Scatter.
   Only the learned scatter state for the old monster resets, as on any focus
   change.
10. **Monsters with no achievements, or finished ladders.** They are never
    targets, and listing them is harmless.
