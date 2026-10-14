# Safe reload walking observation

Failure inventory recorded before changing the native scenario:

- Run 38551000643 shard 5 physically reached the exact requested Main destination
  (1520, -70). The completed owned journey had 2.722 seconds of actual walking.
- Repeated `LiveClient.run` readiness checks spaced admission observations about
  2.3–3.2 seconds apart. One observation preceded walking; the next arrived after
  native movement stopped, twenty milliseconds before journey completion.
- Read the current game character and current CODE movement service coherently in
  one game-frame evaluation. Poll at 50–100ms without repeatedly performing the
  generic runner readiness preflight. Require the same actor, live journey ID,
  movement, map and exact goal; keep the 260-unit route and 30-second deadline.
- Preserve the subsequent same-journey parked hold, reload eligibility, physical
  arrival, real CODE replacement, resumed farming and native roaming defense.
  Do not lengthen routes, fabricate movement or relax readiness to historical state.

Both safe and immediate native reload scenarios passed locally in 1.9 minutes,
with 93 verified evidence files retained under
`.build/reload-walking-observation-passing/`. The safe case observes and parks the
same owned walk, and both cases verify farming and roaming defense after reload.
