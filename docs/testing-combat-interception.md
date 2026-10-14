# Predictive native combat interception

Failure inventory BEFORE implementation: user observed Ice Golem approach repeatedly
chasing current positions with tiny direct steps. Own committed arrival handoff
is separately latched. Moving targets can still outrun ordinary current-position
approach. Actual native formationMotion already derives direction from moving,
going_x/y and speed, capped at native destination. Reuse it; never derive velocity
from delayed status differences or guess stationary/teleport motion.

Solve the first nonnegative root of |target-self+velocity*t| <= ownSpeed*t+reach.
Reach is current native hitbox-adjusted attack radius, separate from futurecenter.
Use at most2seconds and native remaining leg duration. If target cannot be caught
on that leg, lead toward its bounded future endpoint; invalid/stationary motion or
invalid own speed returns currentcenter. Prediction never proves attack readiness.
Goal sampling must consume supplied projectedcenter, with current hitboxradius;
ordinary chase uses same helper only out of actual native range. All native
terrain/selfpoint/directconnector checks and existing safety guards remain.

Pre-code retained failures: away/toward/perpendicular interception, faster target,
stop endpoint, zero/NaN/missing motion/speed, actual projected port goal rather
than ignored argument, ordinary out-of-range lead and already-ready unchanged.
Existing controller replan250ms/12px thresholds and pending smart progress remain;
new meaningful projected direction changes affect direct routes without cancelling
useful pending smart route. Initial and precommit currentrange checks/double
confirmation remain the sole attack truth. Unit agent owns native before-code
moving scenario and root serial local acceptance; no native processes here.

Before readonly telemetry amendment: native proof requires actually issued c.point,
not a newly computed prediction. Add retained report immutability case BEFORE
exposing a cloned issued center; observer will retain it on existing socket emits.

Before ordinary formation scorer amendment: its current-target range ranking can
outvote the generated lead candidate before approachCombatTarget executes. Add
an actual shared formation emitted-step regression with a transverse moving
monster and healing coverage, then use the projected body for OUT-OF-RANGE
progress scoring only. Actual target/other-monster safety, native collision,
healing/facing and all attack/readiness checks remain current authoritative data.

Before issued-input metadata amendment: packet-time motion can differ from the
native leg used to choose a lead point. Preserve immutable issue-time target,
native leg destination/speed, self/speed, reach, projection time and issue time;
never recompute these from a later packet. Add retained immutability regression
before exposing this optional diagnostic alongside issuedpoint.

Before numeric projected-body amendment: native17665 distance chooses monster
combat dimensions by type/mtype; native15555 uses visual width/height. Preserve
both semantics with numeric body plus type/mtype and original map/instance
presence; never clone renderer entities. Add before-amend retained native-distance
parity at projected coordinates for both pinned revisions.

Before real/render coordinate consistency amendment: prediction uses native
real_x/y, but existing combatApproachPoint/goal reach subtraction used x/y.
A stale renderer center can therefore inflate the hitbox offset/ring. Add retained
actual-source mismatch regression BEFORE normalizing current centers, direction
and reach subtraction to the same real coordinates (finite x/y fallback). This
changes aiming only; readiness remains native and issue evidence remains actual.

Before ten-unit drift-buffer amendment: user explicitly requires aim range-10
(clamped to1 for short weapons). Prediction must use that same hitbox reach;
ordinary out-of-range approaches cap existing desired spacing at this buffer,
without changing already-ready melee kite behavior. Actual readiness is still
native is_in_range, not arrival at the smaller radius.

A pending precommit route may continue safely toward the buffer while actual
readiness is advertised immediately. Stop at actual native inner-buffer distance,
route completion or immediate committed handoff. Initially-ready actors start no
extra route; no confirmation delay is introduced. Pending smart progress survives
range loss while buffering. Pre-amend retained cases cover radius/short reach,
same prediction reach, normalready spacing, immediate ready while buffering,
commit/innerstop, initiallyready and retained smart progress.

Validation: the final nine focused native scenarios passed in 15.1 minutes, with
367 evidence files verified. This includes both Main hawk terrain cases, actual
moving-target lead packets, fresh whole-party confirmation, blocked-ray ranged
readiness, manual event exits/restart persistence, and Mr Pumpkin lost-completion
recovery. Hawk first damage from all three actors occurred within 7.3 seconds.
The final range-margin/controller/policy checks also passed (189 tests), as did
four real HTTP restart-readiness checks. These results do not replace full CI.
