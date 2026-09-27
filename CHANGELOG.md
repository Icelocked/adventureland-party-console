# Changelog

- Fixed coordinator startup on oversized saved-state journals: stream records and compact by size without constructing one giant string. Preserve existing state and writer locks.

- Unified Hunt turn-in and anniversary staging returns: attack aggressors while planning and walking, cancel interrupted party Town casts together, resume Town after aggro clears, and retain bounded route retries. Removed independent anniversary casting and return combat/loot stops.

## Unreleased

Changes queued for the next release. The release workflow determines its version
from the commits merged into `main`.

### Added

- Refresh upgrade chances is a prioritized merchant job that borrows missing scrolls and offerings from the bank without buying supplies, returns them after calculation with interrupted-transfer recovery, and saves results across reopenings and restarts. Any real merchant upgrade invalidates saved chances; the menu shows queued/running status and missing supplies.

- Steam primary/login actions can launch a local Windows or native Linux client,
  or attach to a running client with automation enabled. The bridge must be ready
  before headless ownership is released; completion still requires native CODE
  reports. Setup choices prevent launching a client on a different PC. A running
  client without automation enabled requires one close and retry. Windows was
  verified live; Linux has protocol tests and still needs live desktop validation.

### Added

- Merchant setting for upgrade purchase batches (default 1), with bulk starting-tier scrolls, durable item ownership, and completion of every purchased item.

### Fixed

- Keep every right-click menu, submenu, and embedded upgrade preview white with black text, including focus and hover states.

- Correct preview text encoding. Distinguish unavailable and partial chances from successful previews, and wait for bank data before borrowing supplies.
- Release convoy pauses when merchant jobs fail, expire, clear, yield, or change realm. Ignore late handoff completions without overwriting newer commands; preserve the original Hunt/event destination.

- Prevent Town-rally arrival from falsely failing Hunt runtime readiness; defer merchant work while Hunt owns movement instead of repeatedly failing handoffs.

- Buy-with-upgrade follows relocated items and requires a matching server failure
  before logging destruction or buying another base item. Uncertain outcomes retain
  their journals instead of abandoning partially upgraded survivors.

- Updated Hunt and farming UI test fixtures for execution-state clearing and the
  preferred-spawn dialog; nested-dialog checks count only open dialogs.

- Fixed Hunt departures stuck at Daisy when later door approaches crossed scenery.
  Validate reachable interaction points and bounded local detours before accepting
  the shared route, preserving the selected destination and recovery limits.

- Fresh headless reports now override stale Steam connection observations, so a
  successful Steam-to-headless transfer no longer hides the character behind a
  false "Connection lost" card.

- Hunt off/on now resets execution, holds, failure counts and blacklist while retaining live quests and saved settings. Removed arbitrary-door route recovery; exhausted routes try another actual monster spawn. Retire saved relocation detours.

- Added Farming Settings > Set preferred hunt spawns: expand monsters with multiple available spawns and save a destination for future Monster Hunts. Automatic selection remains the default; normal farming is unaffected.

- Set alpathfinder route-cost speed to 200 for all planner calls, replacing the inflated no-Town estimate that could discourage useful door and tunnel routes.

- Hunt returns now release a failed travel hold after fresh, matching reports
  verify the whole party stopped at Daisy, allowing quest turn-in to continue.
  Recovery also accepts holds reissued after restart and ignores released Escape
  history, while preserving current navigation ownership and retry budgets.

- Improved dashboard performance by memoizing character cards, inventory/equipment,
  bank and stand panels, monster controls, and upgrade-offering context, with
  stable data and action props to avoid unrelated renders.
- Equipment catalog uses infinite scroll, loading more items automatically as
  you approach the bottom while keeping the initial render bounded.
- Dashboard settings, rules, and marks use a separate 15-second configuration
  poll; actions refresh them immediately while live progress retains fast updates.
- Live logs reuse derived entries and rendered rows when their contents have not
  changed, reducing repeated sorting and rendering during long sessions.
  ([#22](https://github.com/Ryan-Haines/adventureland-party-console/issues/22))
- Added the pinned game-17175 route fixture and refreshed Hunt, convoy, and
  coordinator-storage regression fixtures for repeatable offline validation.

- Long-running coordinators no longer retain complete character heartbeats in
  rare-target rejection receipts. Existing receipts are compacted without losing
  rejection evidence, and unchanged merchant queue checks avoid redundant saves.
- Upgrade and compound jobs preserve unfinished work after movement communication
  failures, retrying with persistent 10/30/60/300-second backoff.
- Added `scripts/watch-console.ps1` to follow redirected local console logs in a
  visible terminal, with `-Errors` for stderr.
  ([#21](https://github.com/Ryan-Haines/adventureland-party-console/pull/21))

- Franky attendance now targets only the Franky monster, approaches into attack
  range, and holds position without kiting, formation movement, or warrior Dash.
  Approaches ignore monster danger zones while respecting terrain. Adds cannot
  become fallback or offensive-skill targets; healing and event recovery continue.
- Buy-with-upgrade orders preserve confirmed purchases, upgrade results, budgets,
  attempt limits, and reserved items through interruptions and restarts. Priority
  work yields between completed item cycles; movement failures retain the order
  with bounded retry delays and visible retry status.

- Hunt route failures now use bounded segment repair, native fallback and origin
  relocation before trying another spawn. Recovery budgets survive replacement
  convoys and restarts, with explicit causes when movement remains held.
- Convoy phase changes no longer send duplicate cruise caps. Movement diagnostics
  identify command takeovers and retain the original planner failure.

- Delivered equipment pauses and resumes convoy travel without replacing its
  ownership; combat during merchant recovery no longer deadlocks the regroup hold.

- Hunt pickup travel recovers a missing completion acknowledgement after verified
  party arrival, preventing an idle party at Daisy from remaining in sync travel.

- Joinable events such as Franky use direct teleportation for entry and respawn
  recovery, without waiting for a convoy. Arrival is verified before clearing
  recovery, and failed event walks no longer leave characters unable to attack.
- Event combat closes into boss range before kiting. Avoiding adds no longer
  pulls characters away from the boss; blocked kiting tries safe approach and
  escape directions instead of leaving characters stuck in corners.
  ([#21](https://github.com/Ryan-Haines/adventureland-party-console/pull/21))

- Hunt event exits resume the current quest instead of an obsolete farming
  checkpoint. Dedicated event-map evacuation survives restarts, delayed clients,
  and Hunt toggles; completed anniversary visits hand back to current Hunt policy.
- Hunt communication holds retain matching runtime and command acknowledgements
  through defensive combat. Recovery reconciles dead and released encounters,
  checks loot, and regroups toward the original destination.
- Rare travel interruptions share convoy ownership. Fairy targeting no longer
  depends on a detached support controller, and unsuccessful pursuits retain
  their progress/retry evidence across restarts instead of reopening on wandering.
- Members separated by a map transition can join a travel encounter under its
  existing owner. Hunt reconciles verified arrival before optional acquisition,
  and reports the encounter or specific catch-up blocker instead of stale status.
  ([#21](https://github.com/Ryan-Haines/adventureland-party-console/pull/21))

- Invisible rogue recipients reveal themselves for merchant servicing, then resume
  their normal invisibility behavior. ([#10](https://github.com/Ryan-Haines/adventureland-party-console/pull/10))

- Enabled passive targets with “keep moving” off now interrupt outbound travel
  for coordinated combat, including neutral Phoenix sightings and targets already
  admitted as passing attacks. Explicit stop rules override Hunt travel exceptions.

- Outbound Hunts share one attack target while moving. Additional aggro pauses the
  party for coordinated defense and kiting, then resumes travel to the original
  Hunt destination after the encounter and loot are resolved.
- Hunt automatically restarts its cycle when a participant exhausts retreat routes,
  preserving blacklists and logging the failed character, location, and reason.
- ALClient routes now accept a reachable final waypoint within the requested arrival
  tolerance when the exact endpoint is blocked, matching native routing behavior.
  ([#16](https://github.com/Ryan-Haines/adventureland-party-console/issues/16))
- Monster Hunt convoys pause safely during communication outages and resume after
  stable party reports without consuming movement retries. Arrival acknowledgements
  retry transient failures, and saved completion receipts tolerate lost responses
  and coordinator restarts.
- Warriors skip emergency Stomp when no compatible basher is equipped, preventing
  repeated wrong-weapon errors while allowing their normal routine to continue.
- Keep-moving combat shares encounter ownership before attacking, preventing
  retaliation from repeatedly stopping convoys and releasing obsolete defensive holds.
- Marked merchant deliveries now schedule their own visits by default. Merchant
  settings can disable delivery-only trips while retaining deliveries for other
  visits and explicit sends. ([#15](https://github.com/Ryan-Haines/adventureland-party-console/issues/15))
- Removed unused dashboard notices; previously silent validation and action failures
  now use contextual error feedback. ([#14](https://github.com/Ryan-Haines/adventureland-party-console/issues/14))

- Entirely headless rosters can switch realms without a connected Steam character,
  including switches that set a new home realm. Steam connectivity is still required
  when a Steam-hosted character participates; existing readiness checks remain in
  place. ([#13](https://github.com/Ryan-Haines/adventureland-party-console/issues/13))
- Re-engaging CODE after a console logout recovers the Steam session instead of
  replaying the previous logout or character navigation.
- Monster Hunt lifecycle follows current party membership.
- Convoys recover from departure and walking stalls without repeating retry loops.
- Shared-route geometry mismatches get one bounded reload attempt while preserving
  Hunt membership; stale farming and anniversary checkpoints can recover.
- Monster Hunt preserves travel to its origin and recovers missed Daisy arrival
  acknowledgements.
- Merchant collection reservations and routine cancellation recover correctly.

### Changed

- Merchants can independently select supported events, fight with their equipped
  weapon, and resume merchant work after returning. Ordinary merchant jobs,
  gathering, and stand work yield while event participation owns the merchant.
  ([#12](https://github.com/Ryan-Haines/adventureland-party-console/pull/12))

- Reduced dashboard status traffic and isolated position updates from character
  cards while preserving live controls and inventory updates. ([#17](https://github.com/Ryan-Haines/adventureland-party-console/issues/17))
- Reworked the lucky slot mechanism.
- Anniversary participation no longer automatically crafts Sixfold Cakes; complete
  slice sets remain available through the normal exchange menu.
