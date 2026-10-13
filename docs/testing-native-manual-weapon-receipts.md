# Native manual weapon receipt observation

Before amendment, run 38447668827 shard 7, artifact 11839989455, failed server polling for the +6 broom. Actual native player packets prove the +6 broom equipped at 1791917068282 and the +0 rod at 1791917068969, 687 ms later. The saved preference is the +6 broom. Polling missed a legitimate brief equip while gathering resumed.

Require an actual native player mainhand receipt for the +6 broom after the UI request timestamp and baseline sequence, then a later rod/pickaxe packet by native event sequence. Sequence ordering remains valid when packets share a millisecond. Preserve final server broom restoration, restart persistence, unique equipment conservation and all deadlines. Retain bounded receipt evidence even on failure. No synthetic state or gameplay changes.
