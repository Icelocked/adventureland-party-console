# Native Cave farm arrival evidence

Before fixture edit: ea5e6be full38312124158 shard1, artifact11775971514,
failed the600-second poll requiring both positions within70 units simultaneously.
Native sample1791841832538 actually had Warrior47.4 and Priest61.2 units from
928,536. Later combat kiting moved Warrior139 units away; the farm completed
all3 native waves and earned gold/amber, and both owned travel actions completed.
The coordinator polling snapshots missed the transient native near-farm sample.

Failure inventory: stale prior travel/other run/floor/instance positions must not
count; dead or non-fresh actors cannot count; legitimate combat movement must
not erase a real visit; a newly accepted travel resets recorded arrivals; failed
travel still times out; later native combat/objective/floor checks remain intact.

Record each participant's actual position once within the existing70-unit
threshold using existing native sample requests, with fresh alive matching
run/floor/instance and exact accepted travel ID. Retain records in the existing
farm evidence. Keep600-second timeout and all native kill/loot assertions.
