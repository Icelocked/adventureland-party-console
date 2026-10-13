# Delayed Town packet and real recovery walking

Pre-code failure inventory: run38336172428 shard15 artifact11786558337,
scenario7464b283b6f659f9dc73-52dafc630a8fb646f0bc missed the walking overlap.
The original follower Town packet was held at1791860366494 and auto-forwarded
by its unchanged30s cap at1791860397111. Actual server `player` packets before
release show Priest moving at(668.13,785.15) and(757.78,845.78), more than80 units
from incident(520,710). The actual Warrior Town cast packet was observed too.
The driver serialized several remote observations before releasing the packet,
so its predicate did not capture an overlap that real physics produced.

Observe that bounded overlap inside the existing native follower fault. Require
the original packet is still queued, the original native leader interruption is
present in the current actual primary CODE document, and a current same-runtime
owned movement journey is walking toward Main town with Town disabled. Require
both actual native motion and a fresh authoritative own-socket `player` packet
showing more than80 units of real displacement. Record this receipt and release
the original queued packet once. Keep the30s fault cap,60s admission,15s actual
transport and180s genuine Daisy rewards. Do not manufacture, replay or change
packets, native positions, commands, cooldowns or deadline limits.

Read-only completion metadata now covers all four event handoff variants, so
the two ordinary Green/Pumpkin return failures retain the same diagnostics as
their historical recovery variants. This instrumentation changes no responses.
