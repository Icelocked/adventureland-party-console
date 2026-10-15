# Passing kill cross-client receipt causality

Run38330572924 shard11: Warrior attacks507 at1791854906384 while exact convoy/epoch is travelling; native hit11236/kill:true at7201 and death7205. Priest is moving in the same convoy, attacks507 at7221, then receives the identical projectile BgTUTw/native hit at7224 and death7229. Fixture wrongly compares Priest attack time to Warrior receive time, failing by20ms despite valid own-client causality.

Failure modes: different victim/killer/projectile, stale attack, unrelated convoy/epoch/realm/map/instance, stationary or wrong phase, missing native damage/death, or a later farming attack. Compare each peer's own matching native hit receipt with its latest real outgoing attack, preserving2s window and all movement/cohort checks. Never widen45s, fabricate timestamps/attacks, or infer motion from intent. Retain matched per-client native packet receipt in evidence.
