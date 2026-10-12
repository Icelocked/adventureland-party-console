# Native Cave vote resolution race

Failure inventory before fixture changes:

- Full native run 38228085482 passes boss assembly, native Lockbreaker completion, and the declared duel. During later required-room traversal, a vote button resolves enabled but disappears before input dispatch completes.
- Retained artifact 11738073534 shows the same Two People Claim the Chest choice already resolved to `left`, both actual native votes are `left`, the opposing NPC has negative HP, and all required rooms are complete.
- The fixture returns immediately after a click, allowing the next telemetry poll to use an older unresolved observation and attempt a duplicate vote. Raising timeouts or forcing clicks would conceal this race.
- An unrelated click error, a different native choice, another option, absent real vote receipts, or an unresolved choice must remain a failure. Native battle completion and physical travel requirements remain unchanged.

After the real UI input, require the same run/floor/choice to resolve with the exact option voted by both participants. A click timeout may be tolerated only when those identical native terminal receipts already exist. Keep the normal action timeout and retain a ledger of the observed choice/result; do not synthesize votes, deaths or completion.
