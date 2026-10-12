# Respawn fallback movement ownership

Before editing, native run 38304682974 shard 13 artifact 11775281183 records
two owned Goo Hunt routes failing during preparation. The exact stop stack is
death recovery `returnToActivity` → `rejoinFarm` → `beginFarmReunion` →
`stop("smart")`; the current convoy's signal/epoch/command/revision still match.
After two failures the spawn is excluded and the real quest count stays 9995.

Failure modes: delayed ordinary respawn fallback cancels newly acquired convoy
ownership; shared walking is cancelled during acknowledgement/preparation;
explicit reunion commands cease working; ordinary unowned respawn never rejoins.
Write the retained regression before the fix. The no-command fallback must yield
to the already authorized walking/convoy owner. Explicit commands and existing
event-exit/death safety guards remain unchanged. No global stop suppression or
native quest/death/120-second assertion changes are introduced.
