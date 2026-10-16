# Declared duel admission

Before editing, native run 38295589515 shard 1 returned an injected duel seed
with `actors: []`, then threw reading `room.npc.dead`. Both votes eventually
resolved, but their people/scene arrays were empty: the fixture had opened a vote
without admitting the actors its combat assertion required.

Verified pinned native source (`node/logic/cave_of_many_dreams.js`, 15555): `cave_activate`
returns while live actors exceed 52 or an optional noncitizen room follows 512
issued actors. `cave_spawn` rejects optional actors after that issued limit and
all actors at 64. A required encounter bypasses only the lifetime optional cap,
and still honors both live-actor bounds. Safe native placement can also refuse a
spawn, so the old empty seed alone does not identify which admission guard fired.

Failure inventory before changing the declaration:

- Declare this required native combat scenario as required. Do not reset issued
  counters, delete unrelated actors, bypass native capacity or alter game clocks.
- Record actual issued/live counts and native safe placement at declaration.
- Admit through the unmodified native factory only while its live-actor gate is
  open. A bounded 60-second wait may observe natural cleanup, but must fail with
  retained evidence if the factory still cannot provide both actors.
- Never open the vote or dereference an actor until exactly two real NPCs exist.
- Set only the already-declared initial difficulty once, then retain real votes,
  native damage, ally survival, rival death and subsequent room assertions.
- The existing 120-second combat bound begins after actual factory admission;
  this is not a fabricated death or completion.
