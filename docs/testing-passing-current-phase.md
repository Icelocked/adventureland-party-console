# Passing actual convoy phase

Before editing, focused run 38318613829 artifact 11779286975 proves Priest
issued Goo 518 from its travelling convoy, Warrior issued the same nominee
while moving in the same actual convoy about 500 milliseconds later, then the
Priest's native hit/death arrived within two seconds. The Warrior's cached role
debug label still said `convoy:arrived`. That label is updated by role-loop
checks and does not itself expose the current walking owner's phase.

Failure modes: cached labels reject current walking, an actually arrived or
retired owner borrows a later farm kill, or different epochs join a cohort.
Expose the existing local convoy's phase and epoch with its already-observed ID
in the read-only combat trace. Require actual travelling phase and exact
cohort ID/epoch/context alongside the existing moving issuance/time/nominee,
native hit/death and server absence. Do not accept arrived owners or infer
phase solely from motion. The next native run verifies actual captured phase.
