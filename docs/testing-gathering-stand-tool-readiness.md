# Gathering stand tool and readiness prerequisites

Run 38304284684, artifact 11772024161, exhausted the 90-second stand prerequisite before reaching the capacity fixture. The actual initial merchant inventory contained only `hpot1` and `mpot1`; repeated native stand opening correctly failed without a stand tool.

Failure boundaries recorded before editing:

- Declare an initial native `stand0` in free inventory slot 12, verify the received item and actual stand opening, and preserve that tool in the existing 39-occupied-slot seed.
- Read pending commands from the supported `/party-api/state?section=fast` projection. Full state omits that field, so its absence cannot establish command completion.
- Require the fast pending-command object to be present, the merchant idle command to have cleared, and the full-state stand to actually be open.
- Keep the single original 90-second preparation deadline across both pre- and post-restart checks, and retain capacity, cooldown and free-slot assertions.

No production changes, synthetic completion, mutation retries or extended scenario deadlines are introduced.
