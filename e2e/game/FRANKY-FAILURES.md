# Restored Franky recovery: failure modes before the regression

- A globally living Franky can outlast a character's decision to disable it.
- Durable recovery can already contain an acknowledged exit and empty pending
  list while the native character has moved to desertland. Requiring Main again
  prevents Hunt from claiming its completed gscorpion quest.
- An eventual reward alone can hide an unnecessary return to Main. Observe Hunt
  handoff while the actual character is still in desertland, then the real reward.
- The initial historical recovery is explicitly seeded from a sanitized captured
  production failure. It does not claim new Town HTTP receipts were generated.
  Runtime statuses, client movement, Hunt decisions, Daisy interaction, and the
  inventory increment must all come from actual native gameplay.
- Restart must read the durable settings from disk with commands absent, then
  consume fresh browser observations; injecting statuses would hide the bug.
  Recovery and Hunt are profile-scoped. Seed the same historical recovery in
  both the selected profile and legacy global settings; otherwise a null profile
  default can silently discard the recovery and falsely pass the scenario.
- Keep historical names, timestamps, revisions and unrelated players out of the
  fixture. Use the current character's actual persisted navigation revision.

The earlier native full-entry race exposed a real missing-follower recovery bug,
but unrelated exit-convoy retries made it unsuitable for this focused historical
recovery case. Those investigation artifacts are retained outside the test suite.
