# Declared Halloween encounter charge

## Failure inventory before correction

Full run 38423920859, shard 10, artifact 11830807829 failed only Green saved-checkpoint return. Its initial declaration recorded speed 0 and charge 0, but the exact declared boss 522 chased the Priest and delivered native hits until 111 seconds after deselection. No foreign monster supplied those attacks. Native exit Town eligibility was delayed to 112 seconds; two communication holds also occurred. Checkpoint travel began after 155 seconds and remained physically travelling at the unchanged 240-second deadline.

Pinned server 90052162eb3ebda36c893e1eb4af643913c8f984 calculate_monster_stats reads zone_stats for initial speed, then replaces speed with G.monsters[type].charge whenever target/focus exists. The fixture restored the original catalog immediately after construction, so native aggro recalculation used the original Green charge 90. The native common stat floor makes declared charge 0 yield speed 1. This was a fixture declaration mismatch, not a production movement-policy exception.

Before editing, a replay of the actual pinned calculate_monster_stats, calculate_common_stats, and monster_to_client functions proved restored-global charge produces speed 90, while a charge-only declaration produces speed 1. Native wire HP/max HP stay 1074900 and speed remains explicit. Keeping the entire modified catalog instead would omit HP/speed and disagree with clients that already loaded the original catalog. Replay: .build/prove-halloween-native-charge.cjs; result: .build/halloween-native-charge-replay.json.

Possible failures to preserve: an unrelated existing same-type native actor; construction failure; irregular reconstitution of the same declared ID; another change replacing the catalog during the case; pass/fail cleanup; native wire values differing from the declaration.

## Fixture boundary

Keep only the declared charge in the server catalog for the encounter lifetime, after proving no existing same-type native monster. Every other global catalog property remains original. The existing exact-ID irregular reconstruction retains initial difficulty. Restore the exact original object on normal/failure cleanup; refuse to overwrite a different intervening catalog object. No native physics function, HP, timer, defense rule, or return deadline changes.

Failure diagnostics run inside try/finally: catalog restoration occurs even if geometry capture/attachment fails. The encounter seed records charge-only lifetime declaration; a native cleanup artifact records declared/original charge and exact-object restoration. Attachment errors happen after restoration.
