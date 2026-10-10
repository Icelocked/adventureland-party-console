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
