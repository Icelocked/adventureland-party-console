# Native realm setup handoff admission failure inventory

Observed 0dab native shard15 job114924303933: cross-realm setup received spawn409 Resolve the pending handoff first after realm operation completed. Retained final state shows real same-realm Steam primary handoff completed 2.46s after realm completion; Steam realm production scenario passed.

Failure modes before changing fixture: realm arrivals can complete before independently owned Steam handoff finishes; admitting headless spawn then correctly conflicts. A wrong or superseded realm operation must not satisfy readiness. Retrying spawn mutations would conceal admission ownership, and inventing completion would invalidate native evidence. Fix existing setup readiness to require the exact returned realm operation plus actual Steam handoff terminal state within its existing120s budget; no production change or scenario deadline extension.
