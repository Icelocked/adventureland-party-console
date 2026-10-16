# Halloween threshold native attack observations

Pre-code failure inventory: run38330572924 job115079966798 completed the Pumpkin
threshold test failure before cancellation. Artifact11785545769 error context
shows `frame.evaluate: Frame was detached` at live-halloween.spec.ts187. This
read a cached native game Frame's duplicate attack wrapper. Threshold admission,
native hit, loot and boss-resumption assertions did not report a failed predicate.

`live-game-client.ts` already installs an actual outgoing attack observer on
each native socket, preserving the original call, receiver, arguments, errors
and result. `events()` reacquires the current native document, transfers only
new observations, and retains their actual actor/time/sequence across document
retirement. Read that canonical ledger instead of retaining another wrapper
and querying a retired Frame. Filter each actor's actual `attack-issued` packet
at the case's original installation time; the victim ID and actor must match.

Retain strict boss-before-add issuance, native positive hits at all three real
HP thresholds, add loot, native boss resumption/death and server inventory
conservation. No movement, target, damage, spawn, timeout or success fabrication.
The existing native rerun must establish the actual observation contract.

The three native death/reentry/return cases also reuse the existing passive CODE
jQuery completion metadata sampler, to retain actual report receipts and owner
identity around holds. It changes no response, request, timer or freshness limit.
