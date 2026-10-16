# Cave completed-result click race

Failure inventory before amendment: full native d009eb2 shard 1 opened a resolved
shop-result dialog between clickCaveControl's isVisible check and the real map
button click. The 20-second action timed out behind its overlay. This is a valid
native result, not an unresolved vote or failed movement. A one-time precheck is
not sufficient for asynchronously delivered native observations.

During only that control action, use Playwright's locator handler to dismiss the
visible Encounter result by its real Close button. Retain the original action
budget and evidence of the actual result and dungeon state. Never dismiss an
unresolved choice, use force clicks, dispatch hidden controls, or replay mutation
commands. Remove the handler after the click, including failures. Run the exact
native Cave entry journey locally before another full CI submission.

Validation: the exact native Cave entry journey passed locally in 9.1 minutes
(10.5 minutes including setup), with 111 evidence files verified. This run did
not encounter a late result obstruction (all three control ledgers were empty);
the observed race is preserved in the failing CI trace, not claimed as a local
reproduction. Native movement, combat, floor transition and exit all completed.
