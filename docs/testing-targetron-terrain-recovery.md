# Targetron terrain combat recovery

Failure inventory recorded before adding the native regression:

- In the reported UHills layout near (-573, -80), a fighter can hold forever when terrain blocks its direct bearing to the engaged Targetron.
- Ordinary follower movement can conceal a broken combat detour; require combat-owned movement, native collision-clear segments, a path bending away from the blocked original bearing, and an actual weapon attack receipt. Successful optimizer steps need not enter the fallback detour mode.
- Inflated +100 weapon range can conceal healing-coverage constraints and skip meaningful approach movement. Use ordinary native weapon ranges with defensive survival gear.
- Screenshot coordinates can fall on a collision edge in the native catalog. Choose a collision-safe target near the reported priest position (-805, -224), retaining a blocked direct approach from the initial warrior position.
- A forced game-world encounter must preserve native hitboxes, movement collision, targeting and attacks. A stationary, durable encounter is declared fixture setup only.
- Tests must retain the selected coordinates, collision observations, combat positions and native hit receipts so the terrain scenario can be reproduced.

Follow-up UHills selected-target failure inventory (2026-10-11): preserved live
navigation evidence in `.build/selected-sparkbot-investigation/live-combat-window.json`.
The reported cancellations originate in formation recovery's cancel/finish path.
Attempt 1 exhausted safe routing; attempts 2/3 waited 30 seconds and timed out.
The warrior remained at (-536.23,-431.28), despite changing recovery endpoints;
healing coverage can block its first segment while the priest's own approach is
blocked. A follower detour must preserve the selected target, native collision
and monster clearance, and resume coverage before any attack. It must not widen
combat coverage or permit unsafe separation during an engaged fight. Test actual
native movement and damage before allowing stalled-pursuit replacement.

Correction implemented: during acknowledged peaceful formation recovery, the
priest follower may follow the certified wall detour when a warrior owns the
route. Previously only a priest mover admitted this detour; the healer could
remain blocked while the warrior waited for its coverage. Normal attack coverage,
native collision and live monster clearance remain unchanged.

The retained isolated follower regression was written before this correction and
failed with zero issued moves. It now passes, including engaged-combat, direct
route and unsafe-segment rejection. Both follower cases and all 15 formation-path
recovery regressions pass. The full retained priest suite has three failures
(Default defense, party attackers, terrain-blocked priest proposal); each also
fails against an otherwise identical source with this correction removed.

Native selected-UHills journey passes through `npm test`: a real warrior hit on
the selected robot within eight seconds, no attack on the nearby alternative,
and 38 verified evidence files. Passing evidence is retained in
`.build/selected-uhills-green-results/` and `.build/selected-uhills-green-report/`.
The initial two-robot diagnostic run is retained separately as failed; its fixture
admitted the alternative before the intended primary and did not actually freeze
server monster movement. It is not native causal evidence for the healer fix.
The final fixture explicitly parks both native monsters while preserving real
player movement, native hitboxes and attack receipts. The selected native
journey verifies the reported layout; the focused regression proves the precise
healer deadlock. No activation or live restart was performed.
Completed immutable candidate:
`738a6a51fb06e88ad410864154ee90902cf50b442ad9c9ba05ba67d0dafdd0e2`.
Verified its maintained character source matches the final working source.
Active remains `54632700987ae2992a480c61f088823f1f2c9cf2642ed8d1f078220d89752d80`;
this correction requires loading the character assets through the supported full
restart. No activation was performed.
