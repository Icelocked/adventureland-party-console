# Franky failed Town ownership

Before editing, run 38316579600 shard 9 artifact 11778705848 records three
successive Franky exit convoys failing with native `town-unavailable` while
Priest casts. Each retry restarts Town; about 68 seconds are consumed before
walking begins. Both actual living participants remain in level2w when the
unchanged 90-second departure assertion expires.

Failure modes: retry the unavailable/interrupted shortcut repeatedly; treat a
communication timeout as a failed native Town; leak walking-only policy to a
new event cycle or new participants; override superseded exit ownership.
Write retained regressions first. Remember only exact cycle-owned failed Town
convoys, and apply walking-only to their remaining captured participants.
Communication/cancellation/other failure codes retain existing recovery policy.
No native movement or deadline assertions are changed.
