# Gear sets for the tank's kill-time luck swap: failure inventory

Written before implementation. Reported live: (a) the tank swapped only 3 of the 5–6
luck pieces it carried, and (b) gear the swap had moved into the bag was taken by
automatic compound/upgrade rules and destroyed. The auto-detecting planner caused both:
it planned the same best ring/earring for both paired slots, valued luck from the base
item only, skipped equal-luck pieces, and its idea of "held" gear changed with the bag,
so nothing protected it. Gear sets replace it: per character, a `luck` set and a `tank`
set (room for `gold` later), each captured from worn gear; the swap equips exactly the
luck set at the kill and restores the tank set (or the gear worn when the swap began).

1. **Partial swap.** Every carried luck-set member must be worn when the kill lands,
   including both rings and both earrings. Pieces not carried are reported missing,
   not silently skipped.
2. **Too late.** The swap must start early enough for the number of pieces to swap.
3. **Wrong item.** Members are matched by name, level and stats; an identical-name
   lower-level copy must not be worn in a set member's place.
4. **Gear destroyed.** Set members in the bag, and combat gear swapped out by a
   session, must never be selected by automatic compound/upgrade pickups or sent by
   an emergency cleanout. Identical copies that are not set members stay eligible.
   Manual marks are the user's choice and still work.
5. **Restore.** After the kill the tank set (or the captured loadout) is restored in
   full; a tank piece that is not carried falls back to the gear worn before the
   swap, and one that is gone entirely leaves the slot rather than failing.
6. **Capture.** Saving a set records exactly the worn gear for the swap slots; it
   persists across coordinator restarts and is per character. Clearing removes it.
7. **No set saved.** Without a luck set, no swap happens (no guessing).
8. **Not the tank.** Only the designated tank swaps; sets of other characters only
   protect their members.
9. **Interference.** The porcupine weapon swap and manual equipment actions still take
   precedence, as today.
10. **Every automatic rule.** Beyond compound/upgrade pickups, held items must not
    receive automatic bank or merchant collection marks, automatic upgrade marks,
    automatic NPC sales or automatic deconstruction (observed: a luck-set amulet kept
    an Auto bank mark until its marks were cleared by hand).
11. **Invisible hold.** The dashboard must show which bag items are held and by which
    set (`Luck set`, `Tank set`, `Swapped-out gear`) in place of the automatic rule
    labels they are exempt from; manual marks still take precedence, and a spare copy
    keeps showing its automatic rule.

## Chain kills (2026-10-13, after PR #2)

Written before the change. Once the designated tank holds in melee (PR #2), it kills
goos about once a second with the next target selected immediately. The swap session
outlived its target: it restored only on a missing or dead *current* target, so it kept
the luck set until the 10 s safety timeout, restored for about a second, then swapped
straight back, about 12 equips every 10 s with the luck set on ~90% of the time.
Decided: keep luck on while kills keep coming; restore once they stop.

12. **Timeout churn.** While each next target is also about to die, the luck set stays
    on across kills; the safety timeout must not restore and re-swap mid-chain.
13. **Stuck in luck.** When the session's target dies and the next target is not about
    to die (or there is none), the tank set is restored.
14. **Stale timeout.** Handing the session to the next target re-arms the safety
    timeout; a target that stops dying still ends in a restore after it.
15. **Other targets.** A hand-over applies only to this character's next target; a
    dead target with no replacement still restores, as in 5.

## Luck set left on without a swap (2026-10-14)

Written before the change. Reported: the priest tank keeps being found in its luck gear,
even while just starting a long boss. Only the session that put the luck set on can
restore it, and the session is lost when the game client restarts (build activation,
disconnect) or a dashboard equip/unequip relinquishes it, so the tank fights on in luck
gear until a later swap finishes near the next kill. Live journey:
`e2e/live-gear-set-recovery.spec.ts`.

16. **Stranded luck set.** With no swap in progress and no kill imminent, a designated
    tank wearing luck-set pieces where its tank set differs stays in them.
17. **Wrong restore.** Slots go back to the tank set's piece (when carried) or empty
    when the tank set left them empty; slots holding anything else are left alone.
18. **Fights the kill swap.** The correction must not undo a swap in progress or one
    that is about to start for an imminent kill.

## Every equipment slot (2026-10-14)

Written before the change. Reported: swapping the priest's shield does not change the tank
set's "(13 worn)": sets covered 13 slots and left out mainhand, offhand and elixir, the
game's other three `character_slots`.

19. **Slots left out.** Saving a set must record all 16 equipment slots that hold an item,
    including mainhand, offhand and elixir, and the dashboard count includes them.
20. **Weapons not restored.** A luck-set weapon or shield left on with no swap in progress
    goes back to the tank set's (or empty), like the other slots.
21. **Elixir consumed.** Swaps and corrections never equip or unequip an elixir: equipping
    one consumes it and the game refuses to unequip it ("cant").

## Equip a saved set (2026-10-14)

Written before the change. Requested: an Equip button per set, so a small change to a set
does not need every piece swapped by hand before saving again.

22. **Partial equip.** Equip wears every carried member of the set in its slot (both rings
    from identical copies, weapon and shield included) and empties slots the set left
    empty; the elixir is never touched.
23. **Fought by the tank correction.** Equipping the luck set on the designated tank is
    undone within seconds by the stranded-luck correction; a manual equip must pause it
    long enough to edit and re-save the set.
24. **Missing pieces hidden.** Members not carried are reported, not silently skipped.

## Fan farm set (2026-10-17)

Written before the change. Requested: a rogue fan-farming crabs for suckerpunches wears a
set with barely enough damage to one-shot them and the rest in luck and attack speed. The
set is no use anywhere else, so it must come off for bosses, events and other farming.
Live journey: `e2e/live-fan-farm-gear.spec.ts`.

25. **No set.** There is no Fan farm set to save (`/gear-sets` rejects it), and the popover
    does not show one.
26. **Never worn.** A rogue scatter farming mobs Fan of Knives one-shots keeps its normal
    gear although a Fan farm set is saved and carried.
27. **Worn elsewhere.** The set goes on outside scatter fan-farming (grouped farming,
    events, bosses, travel), or stays on after the rogue leaves scatter mode.
28. **Flapping on respawns.** With every farmed mob dead, nothing is in view to judge by;
    the set must stay on rather than coming off between respawns.
29. **Too weak.** A set that no longer one-shots what the rogue is farming stays on, or
    goes back on straight after it was taken off. It must come off, say why, and wait
    before trying again.
30. **Previous gear lost.** Leaving fan-farming must restore what was worn before the set
    went on, including slots that were empty.
31. **Stock taken.** Fan farm pieces in the bag, and the gear waiting to be restored, are
    taken by automatic compound, upgrade or cleanout rules.
