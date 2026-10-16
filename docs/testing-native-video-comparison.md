# Native video comparison failure inventory

Before editing: ordinary focused run 38351877535 left Green without reaching the saved checkpoint inside the unchanged 150-second bound; Follow Pumpkin passed. Actual wire delivery was prompt while renderer notification lag reached 1.86/2.83 seconds. Weighted V8 samples spent 72/74 percent in `(program)`, which does not identify video, GPU, or another native workload.

Risks: disabling recording could hide useful visual evidence, change unrelated test coverage, accidentally alter native physics, or be mistaken for proof of a performance fix. The experiment therefore disables only Playwright context video for the exact two ordinary handoff titles. Defaults remain recording; traces, screenshots, native events, CPU profiles, status observations, deadlines and game inputs remain unchanged. A recording-policy attachment makes the selected condition verifiable. Compare both outcomes and notification lag/profile distributions against the retained baseline before choosing any general policy.

## Recording policy inventory before changing the default

Controlled run 38354339762 passed both unchanged handoffs. Retained response-notification median lag fell 541.83 to 142.64ms for Green and 574.13 to 132.58ms for Follow (74–77 percent); responses above500ms fell104/115 to1/0. Evidence shrank340.4MB to18.3MB. The remaining weighted `(program)` time is still substantial: this comparison does not establish that every performance failure is solved.

Policy risks: silently discarding requested video, removing required screenshots/traces/event proof, and treating absent videos as missing evidence. Default recording will be disabled through the supported native context option, with explicit `E2E_NATIVE_VIDEO=1` or `recordNativeVideo:true` diagnostic opt-in. The special two-title override is removed so opt-in works uniformly. Each run retains its recording-policy attachment. Assertions, game inputs, timing bounds, traces, screenshots and verifier contracts are unchanged. Full native CI remains necessary.
