# Fork vs upstream ledger

Every change on the fork (`Thefonze74065/adventureland-party-console`, branch `adopt/bugfix-1.4`) that upstream (`Ryan-Haines/adventureland-party-console`, branch `bugfix-1.4`) doesn't have, grouped by feature and checked against the upstream issue tracker. Each group says what to do on the tracker: file a new issue, update an existing one, or just comment.

The dated log is in [history.md](history.md) and the maintenance procedure in [runbook.md](runbook.md).

| | |
|---|---|
| Upstream base | `bugfix-1.4` @ 9273ecb, merged as 400fb81 (0c4b4d8 as 7886c52). PR #64 merged into `main` as b4443e4 on 10-15 and released as v1.4.0. Upstream tip 2d35a54 is 16 commits ahead of the fork, not merged |
| Fork head | `adopt/bugfix-1.4` @ 7e46cb7. origin is at 9358a00 (3 unpushed commits); the fork's `main` is still at 373b7ab |
| Divergence | 16 behind; 269 files differ from upstream's tip (2d35a54) |
| Checked | 2026-10-16, against every upstream issue, comment and PR (#13–#131) |

| Status | Count |
|---|---|
| New issue | 0 |
| Update / comment | 9 (2 to do) |
| Done upstream | 38 |
| Matches | 15 (all done but #129 and #130, not commented) |
| Open upstream | 21 |
| Closed | 19 |
| Fork-only | 6 |

## New issue: not represented upstream

Implemented on the fork, with no upstream issue or PR describing it yet.

Nothing unfiled. The giveaway and unconfirmed-purchase fixes were filed as #123 and #124.

## Update / comment: the issue doesn't match the fork's work

Issues filed before the work landed, features that changed with use, and maintainer replies that leave out what the fork already has.

### Exchange rewards that merge into a carried stack

[#28 · commented 10-13](https://github.com/Ryan-Haines/adventureland-party-console/issues/28#issuecomment-6148742376)

[dc57083](https://github.com/Thefonze74065/adventureland-party-console/commit/dc57083)

- The maintainer reported on 10-13 that ruby → box rewards stay in inventory instead of following the default bank rule. Upstream’s bank NPC-sale part (Done upstream earlier) is unaffected.

- Cause: the server clears the exchange placeholder before `add_item`, so a stackable reward (boxes, scrolls, offerings; `armorbox.s = 9999`) merges into a carried stack and the game’s `exchange()` returns no slot. `merchantExchange` recorded rewards only from that slot, so they were never routed.

- Fix: rewards are the unlocked slots that are new or grew during each operation. New live journey `live-exchange-reward-bank.spec.ts`: before the fix nothing was recorded (three armor boxes, 10 `scroll1`, 4 `cscroll1` stayed carried); after it the merged stacks are banked, locked and unrelated stock stays. The `live-economy` exchange journey still passes.

### Auto-merchant marks stuck with a compound rule

[#43 · commented 10-08](https://github.com/Ryan-Haines/adventureland-party-console/issues/43#issuecomment-6056391275)

[10ed1ed](https://github.com/Thefonze74065/adventureland-party-console/commit/10ed1ed)

**Maintainer says**

- Fixed on main in a34c836. Closed 2026-10-08.

**Still broken**

- a34c836 fixed the reconciliation side only. The handoff's pre-send recheck still accepts only `automaticPickup` entries (`shared.js:5188` on bugfix-1.4). The live list gives the slot to the ordinary mark, so with a compound rule every copy is skipped. The native "twelve copies + compound rule" journey failed before 10ed1ed.

- Commented with this cause and asked for it to be reopened.

- 10-09: upstream’s new handoff loop (#66) still has the `automaticPickup`-only recheck, so the fork’s check was re-applied inside it (a311d12).

### Franky off-tank / support routine

[#36 · updated 10-08](https://github.com/Ryan-Haines/adventureland-party-console/issues/36)

[000617a](https://github.com/Thefonze74065/adventureland-party-console/commit/000617a), [91d83bf](https://github.com/Thefonze74065/adventureland-party-console/commit/91d83bf), [9215914](https://github.com/Thefonze74065/adventureland-party-console/commit/9215914), [cf352cd](https://github.com/Thefonze74065/adventureland-party-console/commit/cf352cd), [c2ad881](https://github.com/Thefonze74065/adventureland-party-console/commit/c2ad881), [774fbf5](https://github.com/Thefonze74065/adventureland-party-console/commit/774fbf5)

- The keepalive rule is wrong in the issue. After `S.franky.end`, the event ends once nobody has hit Franky for 20 s. The fork uses a 45 s keepalive from 5 min before the end, then a hit every 10 s in the final minute.

- 10-13: the maintainer closed this as a duplicate when he filed [#114](https://github.com/Ryan-Haines/adventureland-party-console/issues/114) (per-event timid/bold mode) as the general successor.

- Add to #114 (the issue this one was closed into): the tank approaches through adds, Auto mode with a death limit, the off-tank flee reads Franky's aggro from the live entity, and only the encounter's tank uses Absorb Sins.

### Designated tank role and kill-time luck swap

[#39 · updated 10-10](https://github.com/Ryan-Haines/adventureland-party-console/issues/39#issuecomment-6094494402)

[e677dee](https://github.com/Thefonze74065/adventureland-party-console/commit/e677dee), [666d4ed](https://github.com/Thefonze74065/adventureland-party-console/commit/666d4ed), [7be0630](https://github.com/Thefonze74065/adventureland-party-console/commit/7be0630)

- Request 1 is done: the tank field on `/formation`, class-agnostic tank movement, and taunt/absorb limited to the tank.

- 10-10: part 2 rewritten for saved gear sets ([e031ffd](https://github.com/Thefonze74065/adventureland-party-console/commit/e031ffd)), replacing per-slot luck detection and set-bonus counting, plus held-item protection from every automatic rule and its dashboard label.

- 10-13: [Icelocked reviewed the tank role](https://github.com/Ryan-Haines/adventureland-party-console/issues/39#issuecomment-6151875748) on booboos (warrior tank, priest, mage). Verified against the code: (1) `formationMove`, `kiteIfNeeded` and `defensiveFormationMove` run before the only tank check in `approachCombatTarget`, so with a priest the tank kites; (2) an always-holding tank dies out of heal range (hold only above half HP and within the priest’s range); (3) upstream `formationMonsterSafety` fences the mage out (filed as #121). They offered a PR for 1–2 against `adopt/bugfix-1.4` (fork issues are off); needs a native E2E before merging. [Replied](https://github.com/Ryan-Haines/adventureland-party-console/issues/39#issuecomment-6152395622) 10-13 asking for that PR; the E2E will cover a warrior tank and a priest tank (a priest tank stands in melee and absorbs, by your choice).

- 10-13: merged Icelocked’s [PR #2](https://github.com/Thefonze74065/adventureland-party-console/pull/2) (fixes 1–2, e1c955d) after the promised live journey `live-tank-formation-hold.spec.ts` ([9beeab8](https://github.com/Thefonze74065/adventureland-party-console/commit/9beeab8)): without the PR both a warrior tank and a priest tank kite (0 holding samples); with it 4 of 4 pass, warrior holding at 5–44 px, priest standing on its goo at 1–47 px, mage in range. Commented results on the PR.

- Loot consolidation was dropped from the issue: loot reaches each character's inventory on its own, and what matters is the aggro holder's luck gear at the kill.

### Phoenix split search

[#56 · updated 10-08](https://github.com/Ryan-Haines/adventureland-party-console/issues/56)

[6be5492](https://github.com/Thefonze74065/adventureland-party-console/commit/6be5492), [aebe90a](https://github.com/Thefonze74065/adventureland-party-console/commit/aebe90a), [706d2b9](https://github.com/Thefonze74065/adventureland-party-console/commit/706d2b9)

- Point 8 was rewritten for the outrun escape, then restored on 10-08 to “defends itself through ordinary combat” after the escape was discarded.

- Add the two later fixes: a resent search id no longer flips control every second, and encounter/loot routes now retry. In 3 simulated hours: 30 kills (22 before).

- bugfix-1.4 also changes `rare-hunting.ts` (it keeps queued rare hunts), which conflicts with this work.

- Fixed 10-09 ([5166889](https://github.com/Thefonze74065/adventureland-party-console/commit/5166889)): when the Phoenix already has a target, members still converging kept standing still while a gathered member fought it. A new live journey covers it (231 s stalled before, in range after 38.5 s). [Commented on #56](https://github.com/Ryan-Haines/adventureland-party-console/issues/56#issuecomment-6075671935).

### Live WTB counts bank stock

[#31 · commented 10-11](https://github.com/Ryan-Haines/adventureland-party-console/issues/31#issuecomment-6108961383)

[f8458c2](https://github.com/Thefonze74065/adventureland-party-console/commit/f8458c2)

- Closed 09-29 with an `entry?.item` guard, but bank-held items still showed “You have 0” (a Legendary Upgrade Scroll in `items5`). The real cause: the inventory panels only load the bank section while the Bank panel is open, so the market and stand never see the bank.

- The fork loads the bank whenever the market or stand is open. The console E2E had injected the bank into every `/state` response and hid the gap; it now injects the bank into `section=bank` only, and fails without the fix. Commented on 10-11 with the cause and the fix.

### Invite URL from Origin (PR #25)

[#53 · superseded 10-12](https://github.com/Ryan-Haines/adventureland-party-console/issues/53)

[c010e3a](https://github.com/Thefonze74065/adventureland-party-console/commit/c010e3a), [6a96322](https://github.com/Thefonze74065/adventureland-party-console/commit/6a96322)

- #53 described a bug only in PR #25’s server-built invite link. PR #25 is closed in favor of Icelocked’s [PR #104](https://github.com/Ryan-Haines/adventureland-party-console/pull/104) (short access codes), which builds the link in the browser from `location.origin` again and tests it against a different `publicUrl`.

- The fork dropped PR #25 and its own fix (a2b3a4a) in c010e3a and merged PR #104 in 6a96322. #53 can be closed with a comment pointing at #104.

### ChronAL simulation harness

[#58 · updated 10-08](https://github.com/Ryan-Haines/adventureland-party-console/issues/58)

[b3715a3](https://github.com/Thefonze74065/adventureland-party-console/commit/b3715a3), [493e7af](https://github.com/Thefonze74065/adventureland-party-console/commit/493e7af), [303c486](https://github.com/Thefonze74065/adventureland-party-console/commit/303c486), [8239074](https://github.com/Thefonze74065/adventureland-party-console/commit/8239074)

- The issue's "native movement only" limit is gone: the route planner now runs on the virtual clock. Runs also compile the working tree.

- New since the issue: trace windows, death records, the `phoenix-farm.json` scenario, and a list of bugs the simulation found. Update the permalink, which still points at 1ef9ddd.

### Achievement Hunt v2 and the 1.4.0 fixes (PR #131)

[#131 · opened 10-15](https://github.com/Ryan-Haines/adventureland-party-console/pull/131)

Icelocked's [PR #131](https://github.com/Ryan-Haines/adventureland-party-console/pull/131) replaces #89 (closed 10-15) and is built on v1.4.0 (b4443e4), with no merge conflicts, offered as context for the fork's agent and split by section so any section can be taken alone: 1. Achievement Hunt, a fifth farming mode that farms monsters for their kill achievements (`farmingPolicy: "achievements"`); 2. Achievement Hunt fixes (rares as variants, a throwing start); 3. dungeon vote fix; 4. deconstruction retry; 5. movement request budget; 6. repeated log messages; 7–9. tests, live run and known failures. Sections 2–6 touch 8 runtime files; the rest is Achievement Hunt.

- To do: review sections 2–6 against the fork's event, movement and merchant work, and reply on which to take; the Achievement Hunt sections follow the same offer pattern as #89.

## Done upstream: reimplemented on bugfix-1.4, adopted in fdd89f0, 3e414a1, a311d12, 13e8b7c, 1566e02, 43ac030, 7eb464b and 9577eca

The maintainer fixed these on bugfix-1.4 (PR #64, merged into `main` as b4443e4 on 10-15 and released as v1.4.0), often going further than the fork did. Where the fork had its own fix, the merge took upstream’s version and removed the fork’s, including the extras in the last column. [#79](https://github.com/Ryan-Haines/adventureland-party-console/issues/79) (hot reload) and [#94](https://github.com/Ryan-Haines/adventureland-party-console/issues/94) (in-game mute) were also fixed in 1.4, with no fork code; the fork’s base already has both. On 10-15 the maintainer closed most of these with v1.4.0; still open: #23, #35, #57, #83 and #106.

| Issue | Fork commit | Upstream's version | Fork extras (dropped) |
|---|---|---|---|
| [#121](https://github.com/Ryan-Haines/adventureland-party-console/issues/121) | [a26a97d](https://github.com/Thefonze74065/adventureland-party-console/commit/a26a97d) | The maintainer imported the fork’s fix and native E2E as-is ([c1f4159](https://github.com/Ryan-Haines/adventureland-party-console/commit/c1f4159), sampling fix [9d617b6](https://github.com/Ryan-Haines/adventureland-party-console/commit/9d617b6)) and replied on #121 | Nothing: upstream’s copy of the same fix, spec and failure inventory replaced the fork’s in the merge |
| [#106](https://github.com/Ryan-Haines/adventureland-party-console/issues/106#issuecomment-6147378931) commented 10-13 | [958334b](https://github.com/Thefonze74065/adventureland-party-console/commit/958334b) | The planner reads `is_hidden` from the game window’s own data descriptor instead of through the CODE facade, so it saves and restores the native function ([4677651](https://github.com/Ryan-Haines/adventureland-party-console/commit/4677651)) | The facade-side unwrap in `runner-scope.ts` and its `runner-lifecycle` regression test |
| [#96](https://github.com/Ryan-Haines/adventureland-party-console/issues/96) | — | [dc38439](https://github.com/Ryan-Haines/adventureland-party-console/commit/dc38439): discovery uses the inferred square once it is inferred; the sequential cursor stays for the search | Nothing (no fork code) |
| [#97](https://github.com/Ryan-Haines/adventureland-party-console/issues/97) | — | Tracktrix drill-down data for monsters such as Targetron ([dc38439](https://github.com/Ryan-Haines/adventureland-party-console/commit/dc38439)) | Nothing (no fork code) |
| [#77](https://github.com/Ryan-Haines/adventureland-party-console/issues/77) | — | Superseded navigation no longer blocks the party after a realm switch ([dc38439](https://github.com/Ryan-Haines/adventureland-party-console/commit/dc38439)) | Nothing (no fork code) |
| [#94](https://github.com/Ryan-Haines/adventureland-party-console/issues/94) | — | A mute for game sounds and music in the Steam interface | Nothing (no fork code) |
| [#79](https://github.com/Ryan-Haines/adventureland-party-console/issues/79) | — | Immediate and combat-safe console reloads replace the hot-reload behavior that kept killing characters while an agent edited files | Nothing (no fork code) |
| [#99](https://github.com/Ryan-Haines/adventureland-party-console/issues/99) | [99497d5](https://github.com/Thefonze74065/adventureland-party-console/commit/99497d5), [33c85ab](https://github.com/Thefonze74065/adventureland-party-console/commit/33c85ab) | Party-member Exchange and Auto exchange hand selected stock to the merchant ([dc38439](https://github.com/Ryan-Haines/adventureland-party-console/commit/dc38439)) | The fork’s processing pickup, its live spec and failure inventory, README paragraph |
| [#100](https://github.com/Ryan-Haines/adventureland-party-console/issues/100) | [ac1278d](https://github.com/Thefonze74065/adventureland-party-console/commit/ac1278d), [08f490f](https://github.com/Thefonze74065/adventureland-party-console/commit/08f490f) | The fork’s design adopted almost verbatim: the transfer row is reserved only while a BankBoi exists ([dc38439](https://github.com/Ryan-Haines/adventureland-party-console/commit/dc38439)) | The fork’s live spec, failure inventory, docs, staging fixtures and the sort-signature refresh |
| [#101](https://github.com/Ryan-Haines/adventureland-party-console/issues/101) | [c17452f](https://github.com/Thefonze74065/adventureland-party-console/commit/c17452f) | `resolveUpgradeOffering` committed ([9b36edb](https://github.com/Ryan-Haines/adventureland-party-console/commit/9b36edb)) | The fork’s `offeringRule` substitution |
| [#102](https://github.com/Ryan-Haines/adventureland-party-console/issues/102) | [f0d82d4](https://github.com/Thefonze74065/adventureland-party-console/commit/f0d82d4) | Link-free dependency caches with `--no-bin-links` ([57772e9](https://github.com/Ryan-Haines/adventureland-party-console/commit/57772e9)); tested on Linux | The fork’s identical change |
| [#75](https://github.com/Ryan-Haines/adventureland-party-console/issues/75) | [d888d45](https://github.com/Thefonze74065/adventureland-party-console/commit/d888d45) | Combat-terrain recovery: a mage closes on its own target, approaches route through reachable sides and multiple corners ([6100c78](https://github.com/Ryan-Haines/adventureland-party-console/commit/6100c78), [a7a8db2](https://github.com/Ryan-Haines/adventureland-party-console/commit/a7a8db2)) | The fork’s target-risk exemption and `mage-standoff-failures.md` |
| [#83](https://github.com/Ryan-Haines/adventureland-party-console/issues/83) | [9129853](https://github.com/Thefonze74065/adventureland-party-console/commit/9129853), [acdf0da](https://github.com/Thefonze74065/adventureland-party-console/commit/acdf0da) | Blocked melee approaches use reachable sides of the target and keep a local detour; only healthy, unattacked melee may leave priest coverage while its target fights another member ([6100c78](https://github.com/Ryan-Haines/adventureland-party-console/commit/6100c78)) | The fork’s open-side detour, “separate skips coverage” and `melee-wall-stall-failures.md` |
| [#85](https://github.com/Ryan-Haines/adventureland-party-console/issues/85) | [fee19ed](https://github.com/Thefonze74065/adventureland-party-console/commit/fee19ed) | Recovery goals use the visible native monster body and range-capped edge distance ([6100c78](https://github.com/Ryan-Haines/adventureland-party-console/commit/6100c78)) | The fork’s hitbox goal solver, `terrain-recovery-goals.test.cjs` and `terrain-goals-hitbox-failures.md` |
| [#93](https://github.com/Ryan-Haines/adventureland-party-console/issues/93) | [6fbff2b](https://github.com/Thefonze74065/adventureland-party-console/commit/6fbff2b), [0727f29](https://github.com/Thefonze74065/adventureland-party-console/commit/0727f29) | Active returns hand members to their next selected live event, carrying the checkpoint, and new returns leave them out ([a51d3bf](https://github.com/Ryan-Haines/adventureland-party-console/commit/a51d3bf)); live journey `live-event-return-handoff.spec.ts` | The fork’s release code and isolated tests. The fork’s follower and leave journeys and its walk fix (359b370) stay |
| [#86](https://github.com/Ryan-Haines/adventureland-party-console/issues/86) | None | Steam merchants navigate their native game page after an accepted giveaway, Ponty or ALData realm switch, and get a native command for home returns ([5c199b8](https://github.com/Ryan-Haines/adventureland-party-console/commit/5c199b8)). Opened by Icelocked; closed 10-15 with v1.4.0 | None. The fork had no fix |
| [#92](https://github.com/Ryan-Haines/adventureland-party-console/issues/92) | [629a4f7](https://github.com/Thefonze74065/adventureland-party-console/commit/629a4f7) | Delete refreshes the roster first and forgets a BankBoi the game no longer has, despite stale storage ([d5a8217](https://github.com/Ryan-Haines/adventureland-party-console/commit/d5a8217)) | The fork’s cached-roster shortcut and its tests |
| [#23](https://github.com/Ryan-Haines/adventureland-party-console/issues/23) | [48fd8ea](https://github.com/Thefonze74065/adventureland-party-console/commit/48fd8ea) | Statistical elimination over the 42-way joint posterior; Ruled out rows and count | None |
| [#63](https://github.com/Ryan-Haines/adventureland-party-console/issues/63) | [943dae1](https://github.com/Thefonze74065/adventureland-party-console/commit/943dae1) | One shared asynchronous simulation estimator (60M rolls per cart, cancellable); fewer than 30 completed runs marks a line unavailable, which needs a confirmed gold cap. Capped at +12 | The Crowns-style analytic budget for targets too hard to simulate, and the fork’s E2E spec |
| [#73](https://github.com/Ryan-Haines/adventureland-party-console/issues/73) | [943dae1](https://github.com/Thefonze74065/adventureland-party-console/commit/943dae1) | Native grade grace modifiers +1/−1/−2 in the same estimator; server-wide and player grace omitted | None |
| [#66](https://github.com/Ryan-Haines/adventureland-party-console/issues/66) | [1448ba2](https://github.com/Thefonze74065/adventureland-party-console/commit/1448ba2) | Bag-only handoffs interleave with combat under one 30 s send budget; engaged fighters never approach the merchant; partial cleanout retries after 10 s | None. Upstream goes further. |
| [#69](https://github.com/Ryan-Haines/adventureland-party-console/issues/69) | [a8bd850](https://github.com/Thefonze74065/adventureland-party-console/commit/a8bd850) | Generic expiry leaves the switching phase to its own 60 s deadline | None |
| [#70](https://github.com/Ryan-Haines/adventureland-party-console/issues/70) | [461089b](https://github.com/Thefonze74065/adventureland-party-console/commit/461089b) | Idle merchant reservation released when the featured player is unavailable | None |
| [#71](https://github.com/Ryan-Haines/adventureland-party-console/issues/71) | [08fb532](https://github.com/Thefonze74065/adventureland-party-console/commit/08fb532) | Farm recovery holds during staging; old-round handoffs no longer release newer staging | None |
| [#72](https://github.com/Ryan-Haines/adventureland-party-console/issues/72) | [55490fd](https://github.com/Thefonze74065/adventureland-party-console/commit/55490fd), [1adb8aa](https://github.com/Thefonze74065/adventureland-party-console/commit/1adb8aa) | Connector resend after 1 s without progress, revalidated after a scatter correction; Escape owns throttled revival | None |
| [#74](https://github.com/Ryan-Haines/adventureland-party-console/issues/74) | [6e3c403](https://github.com/Thefonze74065/adventureland-party-console/commit/6e3c403) | Merchant realm requests persist independently of home; three bounded home-return attempts, then explicit Retry | None. The fork’s chase-return retry (#46) is separate and stays |
| [#47](https://github.com/Ryan-Haines/adventureland-party-console/issues/47) | [16e4aac](https://github.com/Thefonze74065/adventureland-party-console/commit/16e4aac), [6f45d18](https://github.com/Thefonze74065/adventureland-party-console/commit/6f45d18) | Normalizes null metadata, settles destroyed commerce upgrades, and holds dispatch while `upgradeInventoryBusy` is set | Discard-journal button, `luckyRecoveryError` live field, merchant held from Town. Upstream won't clear journals automatically. |
| [#35](https://github.com/Ryan-Haines/adventureland-party-console/issues/35) | [0be7492](https://github.com/Thefonze74065/adventureland-party-console/commit/0be7492) | Not planned. 1.4 prevents stuck production journals instead; ambiguous outcomes still need an explicit review | Decided: drop the fork's review UI when adopting 1.4 |
| [#67](https://github.com/Ryan-Haines/adventureland-party-console/issues/67#issuecomment-6073356279) | [de5ad30](https://github.com/Thefonze74065/adventureland-party-console/commit/de5ad30) | Separate Mr. Pumpkin, Mr. Green and Slenderman rows, staging before the announced spawn, Slenderman search (06c362a) | Single Halloween row; Auto/Off-tank/Tank routines and open-map retreat |
| [#48](https://github.com/Ryan-Haines/adventureland-party-console/issues/48) | [cb0b28a](https://github.com/Thefonze74065/adventureland-party-console/commit/cb0b28a) | Spawn checks only the joining character | None |
| [#50](https://github.com/Ryan-Haines/adventureland-party-console/issues/50) | [0c5bce8](https://github.com/Thefonze74065/adventureland-party-console/commit/0c5bce8) | Spawns on the native account home | None |
| [#52](https://github.com/Ryan-Haines/adventureland-party-console/issues/52) | [421321e](https://github.com/Thefonze74065/adventureland-party-console/commit/421321e) | Every character, including offline ones (temporary sequential login), with a confirmation dialog | None. Upstream goes further. |
| [#55](https://github.com/Ryan-Haines/adventureland-party-console/issues/55) | [7be0630](https://github.com/Thefonze74065/adventureland-party-console/commit/7be0630) | Binds lucky data to the stable `CH_` character ID | Manual reset button, probably redundant now |
| [#57](https://github.com/Ryan-Haines/adventureland-party-console/issues/57) | [01e64c3](https://github.com/Thefonze74065/adventureland-party-console/commit/01e64c3) | WeakMap indexes plus a tombstone Set, as specified | None |
| [#59](https://github.com/Ryan-Haines/adventureland-party-console/issues/59) | [4f7efdf](https://github.com/Thefonze74065/adventureland-party-console/commit/4f7efdf) | Keeps 2,048 receipts, batches saves within 1 s, stores objects | None. Upstream goes further. |
| [#60](https://github.com/Ryan-Haines/adventureland-party-console/issues/60) | [de71645](https://github.com/Thefonze74065/adventureland-party-console/commit/de71645) | Same logging block | None |
| [#61](https://github.com/Ryan-Haines/adventureland-party-console/issues/61) | [9e8b77e](https://github.com/Thefonze74065/adventureland-party-console/commit/9e8b77e) | parse5 allowlist sanitizer (`sanitize-doll-html.ts`) | None. Two sanitizers would conflict, so drop the fork's `safe-doll-html.ts`. |
| [#62](https://github.com/Ryan-Haines/adventureland-party-console/issues/62) | [64f5791](https://github.com/Thefonze74065/adventureland-party-console/commit/64f5791) | Start token, boot ID and PID namespace, plus a Linux `flock` | None. Upstream goes further. |

## Matches: the issue already describes the fork's change

A comment saying where it's implemented, with the commit link, is enough.

| Issue | Feature | Fork commits | Note |
|---|---|---|---|
| [#130](https://github.com/Ryan-Haines/adventureland-party-console/issues/130) maintainer, not commented | Stand item with "Purchase outcome unconfirmed; reconciliation required" | [bf5da1b](https://github.com/Thefonze74065/adventureland-party-console/commit/bf5da1b) | The unconfirmed-purchase state that #124 filed: the fork's `resolve-purchase` flow and the WTB row's "It was bought / It wasn't" controls clear it. Comment pointing to #124 |
| [#129](https://github.com/Ryan-Haines/adventureland-party-console/issues/129) maintainer, not commented | Giveaway entry: host not visible at the market; can't join in the bank | [15c2f2a](https://github.com/Thefonze74065/adventureland-party-console/commit/15c2f2a) | A host not in sight is looked up through `/api/pull_merchants` and walked to; another realm, no open stand and inside-the-bank hosts are reported; bank giveaways are not queued. Also: jobs expire at the observed remaining minutes, and an unattempted expiry logs a warning and releases its claim. `live-giveaway-locate.spec.ts` |
| [#116](https://github.com/Ryan-Haines/adventureland-party-console/issues/116#issuecomment-6184053452) yours, commented 10-14 | Keep a set amount of an item, auto-sell the rest | [9358a00](https://github.com/Thefonze74065/adventureland-party-console/commit/9358a00) | “Keep in storage” on the auto NPC-sale dialog; spare = bag + bank + BankBois outside craft reservations, less pending sales; bank stacks withdrawn while spare remains, carried stacks sold down to the spare quantity. `live-npc-sale-keep.spec.ts`: 600 → exactly 250 kept |
| [#124](https://github.com/Ryan-Haines/adventureland-party-console/issues/124) filed 10-14 | An unconfirmed stand purchase blocks its WTB forever | [bf5da1b](https://github.com/Thefonze74065/adventureland-party-console/commit/bf5da1b) | `resolve-purchase` (refused while the job is current or queued) and “It was bought” / “It wasn’t bought” on the WTB row; `live-wtb-unconfirmed-purchase.spec.ts` |
| [#123](https://github.com/Ryan-Haines/adventureland-party-console/issues/123) filed 10-14 | Join giveaway can’t target a host who isn’t loaded | [243a6c7](https://github.com/Thefonze74065/adventureland-party-console/commit/243a6c7) | “Use “Name”” for a typed host name, outside the cmdk group; `live-giveaway-manual-name.spec.ts` |
| [#119](https://github.com/Ryan-Haines/adventureland-party-console/issues/119) filed 10-13 | Cave actions and ALData Copy key fail from the README’s plain-HTTP LAN address | [cab085a](https://github.com/Thefonze74065/adventureland-party-console/commit/cab085a), [e6a44d7](https://github.com/Thefonze74065/adventureland-party-console/commit/e6a44d7) | `crypto.randomUUID` and `navigator.clipboard` exist only in secure contexts. Operation IDs fall back to `getRandomValues`; `copyText` falls back to `execCommand('copy')` and otherwise reveals the key. `live-cave-insecure-origin.spec.ts` maps `party-lan.test` to 127.0.0.1 for a real non-secure origin |
| [#118](https://github.com/Ryan-Haines/adventureland-party-console/issues/118) filed 10-13 | Support Podman (docker CLI emulation) for the Cave debug instance | [bf9dee9](https://github.com/Thefonze74065/adventureland-party-console/commit/bf9dee9), [9f1db33](https://github.com/Thefonze74065/adventureland-party-console/commit/9f1db33) | Feature request. Linux check reads `info` JSON with a `host.os` fallback; `/health` probed with `exec` since the OCI build drops `HEALTHCHECK`; containers removed in two passes; docs note on `/etc/containers/nodocker`. The Podman launcher is no longer a fork-only exception |
| [#117](https://github.com/Ryan-Haines/adventureland-party-console/issues/117) filed 10-13 | Cave debug instance exits on start: `ERR_MODULE_NOT_FOUND` for `native-graphics-diagnostic.js` | [9f1db33](https://github.com/Thefonze74065/adventureland-party-console/commit/9f1db33) | The `.js` import from upstream d505e5e breaks the plain-Node load on every platform; the fork imports the `.ts` file. Podman parts split out to #118 |
| [#109](https://github.com/Ryan-Haines/adventureland-party-console/issues/109) filed 10-12 | Stat-scroll visits never withdraw scrolls from the bank | [d3c613a](https://github.com/Thefonze74065/adventureland-party-console/commit/d3c613a) | `preloadStatScrolls` passed the list index as the count to `retrieveFromBankUntil`, so banked STR/INT/DEX/VIT scrolls were bought again and other stat scrolls failed as missing. Live journey `live-stat-scroll-bank.spec.ts` failed before the fix (bank copy left, scroll bought) and passes after it |
| [#65](https://github.com/Ryan-Haines/adventureland-party-console/issues/65#issuecomment-6137532427) maintainer, commented 10-12 | Prim stacking | [ea74b74](https://github.com/Thefonze74065/adventureland-party-console/commit/ea74b74) | Mark for upgrade → Prim stack… on a merchant inventory item: Primling only (+0.5 grace) or Primling + the item’s own stat scroll (+1, grade’s scroll count, `stat_type` unchanged), stacked to a target grace read from an offering-only calculate; the chances panel shows grace. Live journey `live-prim-stack.spec.ts` reads native `item.grace` and failed before the change |
| [#107](https://github.com/Ryan-Haines/adventureland-party-console/issues/107#issuecomment-6137246034) maintainer, 10-12 | Event boss realm chase (boss-chase half of the closed #46) | [44fe74e](https://github.com/Thefonze74065/adventureland-party-console/commit/44fe74e), [198841d](https://github.com/Thefonze74065/adventureland-party-console/commit/198841d), [6e3c403](https://github.com/Thefonze74065/adventureland-party-console/commit/6e3c403) | The maintainer opened #107 from the ALData description; commented 10-12 with the fork’s hop rules (5-min stale sightings, PVP/blacklist excluded, 15–120 min ETA window, stalled local boss, 30-min home respawn horizon, 13–16 min respawn lead with 10-min grace, 5-min engage grace, home after 2 missed polls with retried return, manual move ends it, off by default). #46 was closed as not planned; its rotation-prediction half (`daily-chase.ts`, the Event prediction setting and per-row “predicted here” marker) was removed in [6fa7b0f](https://github.com/Thefonze74065/adventureland-party-console/commit/6fa7b0f) |
| [#105](https://github.com/Ryan-Haines/adventureland-party-console/issues/105) filed 10-12 | Fishing and mining wait the full reuse cooldown after a miss | [5f09d68](https://github.com/Thefonze74065/adventureland-party-console/commit/5f09d68) | The game starts the cooldown only on a success (10%/20%); the merchant waited 48/124 min after every miss, about one fish per 8 hours. Misses are now recast; a success records the game’s own cooldown. New live journey `live-gathering-cooldown.spec.ts` declares only the server’s gathering roll |
| [#84](https://github.com/Ryan-Haines/adventureland-party-console/issues/84) filed 10-09 | Optional gapped bank sort | [24f1261](https://github.com/Thefonze74065/adventureland-party-console/commit/24f1261) | Toggle under Merchant settings → Bank sorting (off by default). Each category gets its own rows with free slots; a new type moves a few items instead of the whole bank. Live journey: 11 slot changes for a new front-sorting type in a 40-item bank |
| [#68](https://github.com/Ryan-Haines/adventureland-party-console/issues/68) filed 10-08 | CX jars, cosmetics and emotes on the character card | [07a0224](https://github.com/Thefonze74065/adventureland-party-console/commit/07a0224), [2db524d](https://github.com/Thefonze74065/adventureland-party-console/commit/2db524d), [a0d2269](https://github.com/Thefonze74065/adventureland-party-console/commit/a0d2269) | Jars with Open, owned and worn cosmetics with Wear/Remove, emotes with Use and a target picker. Filed by the fork; no maintainer reply yet |
| [#34](https://github.com/Ryan-Haines/adventureland-party-console/issues/34#issuecomment-6056772204) updated 10-08 | WTB/WTS sort, hide stale, Check | [0e07126](https://github.com/Thefonze74065/adventureland-party-console/commit/0e07126) | All four parts |

## Open upstream: open issues the fork hasn't touched

| Issue | Topic | Fork state |
|---|---|---|
| [#128](https://github.com/Ryan-Haines/adventureland-party-console/issues/128) | Mailbox enhancements. New, opened by the maintainer. | Not started |
| [#127](https://github.com/Ryan-Haines/adventureland-party-console/issues/127) | Add a "cleave" action for scatter farming or when multiple monsters aggro the party. New, opened by the maintainer. | Not started |
| [#126](https://github.com/Ryan-Haines/adventureland-party-console/issues/126) | Look for bosses while navigating to boss location. New, opened by the maintainer. | Not started |
| [#125](https://github.com/Ryan-Haines/adventureland-party-console/issues/125) | Changing farming target during an event leaves the party stuck in main. New, opened by the maintainer. | Not started. The maintainer suspects [cc73174](https://github.com/Ryan-Haines/adventureland-party-console/pull/64/commits/cc73174c21699eb1609fd8c3543) (in the 16 unmerged commits) may already fix it |
| [#122](https://github.com/Ryan-Haines/adventureland-party-console/issues/122) | Fix the position of the “minimize” control in the Steam interface. New, opened by the maintainer. | Not started |
| [#120](https://github.com/Ryan-Haines/adventureland-party-console/issues/120) | Persistent buy orders, optionally “buy until N of an item at a level exist” across bank, merchant and BankBoi. New, opened by the maintainer. | Not started |
| [#115](https://github.com/Ryan-Haines/adventureland-party-console/issues/115) | Ctrl/Shift+click to multi-select items in any inventory context and apply one disposition to all; show only actions valid for every selected item. New, opened by the maintainer. | Not started |
| [#114](https://github.com/Ryan-Haines/adventureland-party-console/issues/114) | Per-event “timid” or “bold” boss mode: timid joins 30 s late, waits for someone else to hold aggro and only heals the party. Opened 10-13; #36 (Franky off-tank) was closed as a duplicate of it. | Partial: the fork's Franky off-tank routine (the #36 work) is the Franky-specific version; the general per-event mode is not started |
| [#113](https://github.com/Ryan-Haines/adventureland-party-console/issues/113) | Fix merchant and top-bar action icons (Force stand, Send to party, Mining, Fishing, Bestiary, Catalog, Stand). New, opened by the maintainer. | Not started |
| [#112](https://github.com/Ryan-Haines/adventureland-party-console/issues/112) | Show each character’s current target, and keep the event boss’s sprite or health bar visible above attack animations. New, opened by the maintainer. | Not started |
| [#111](https://github.com/Ryan-Haines/adventureland-party-console/issues/111) | Add “Auto exchange” to the bank context menu. The body is empty. New, opened by the maintainer. | Not started |
| [#110](https://github.com/Ryan-Haines/adventureland-party-console/issues/110) | Merchant gold donation calculator: gold for a chosen level, or the level and progress a gold amount reaches. New, opened by the maintainer. | Not started |
| [#108](https://github.com/Ryan-Haines/adventureland-party-console/issues/108) | Add an “ignore movement clicks” toggle to the character bar in the Steam interface. New, opened by the maintainer. | Not started |
| [#103](https://github.com/Ryan-Haines/adventureland-party-console/issues/103) | Mark “add stat scroll” and “deliver to” together, delivering only after the scroll is applied. New, opened by the maintainer. | Not started |
| [#76](https://github.com/Ryan-Haines/adventureland-party-console/issues/76) | Route the convoy from whichever character is closest to the destination, with others meeting there; maybe configurable (group at tank or at leader). New, opened by the maintainer. | Not started. Relates to the tank role (#39) |
| [#78](https://github.com/Ryan-Haines/adventureland-party-console/issues/78) | Rules for using higher-tier upgrade scrolls even when not required. New, opened by the maintainer. | Not started. Would build on the #63 estimator |
| [#80](https://github.com/Ryan-Haines/adventureland-party-console/issues/80) | Option to “mark for compounding” items in the bank. The body is a placeholder. New, opened by the maintainer. | Not started |
| [#81](https://github.com/Ryan-Haines/adventureland-party-console/issues/81) | Show contribution-based multi-drops on monster details; investigate items listed twice for one monster with different rates (e.g. Broom). New, opened by the maintainer. | Not started |
| [#82](https://github.com/Ryan-Haines/adventureland-party-console/issues/82) | Auto-cycle PVP-marked items (shadow stones that won't stack) and show the PVP mark on inventory icons. New, opened by the maintainer. | Not started |
| [#95](https://github.com/Ryan-Haines/adventureland-party-console/issues/95) | “Go headless” fails with “Wait for the character’s active inventory operation to finish”. New, opened by the maintainer. | Not started |
| [#98](https://github.com/Ryan-Haines/adventureland-party-console/issues/98) | Inspect and compare an offline character’s equipment and inventory. New, opened by the maintainer. | Not started |

## Closed: closed upstream, nothing outstanding

Every closed upstream issue not covered above. None has fork commits still pending; #42 and #44 only had merge repairs and a revert to upstream’s stand location (4240561).

| Issue | Topic | Closed |
|---|---|---|
| [#45](https://github.com/Ryan-Haines/adventureland-party-console/issues/45) | Event schedule doesn’t distinguish mutually exclusive events. Not planned; the fork’s per-row prediction marker was removed with event prediction ([6fa7b0f](https://github.com/Thefonze74065/adventureland-party-console/commit/6fa7b0f)) | 10-12 · not planned |
| [#44](https://github.com/Ryan-Haines/adventureland-party-console/issues/44) | Merchant stand position hardcoded; installs on one realm overlap | 10-08 |
| [#42](https://github.com/Ryan-Haines/adventureland-party-console/issues/42) | Stale bank-stack recovery state locks a character, deadlocking login | 10-02 |
| [#41](https://github.com/Ryan-Haines/adventureland-party-console/issues/41) | Auto NPC sale list accumulates orphaned duplicate marks | 10-02 |
| [#40](https://github.com/Ryan-Haines/adventureland-party-console/issues/40) | Setup realm picker shows only 6 realms | 10-02 |
| [#38](https://github.com/Ryan-Haines/adventureland-party-console/issues/38) | WTS panel “Hide unaffordable” hides everything | 10-02 |
| [#32](https://github.com/Ryan-Haines/adventureland-party-console/issues/32) | Market search matches internal item IDs instead of display names | 09-29 |
| [#30](https://github.com/Ryan-Haines/adventureland-party-console/issues/30) | Market and bank dialogs hardcode the name GoldMajesty | 09-29 |
| [#29](https://github.com/Ryan-Haines/adventureland-party-console/issues/29) | Movement-plan 503 misreported as a comms fault, blocking the native fallback | 09-29 |
| [#27](https://github.com/Ryan-Haines/adventureland-party-console/issues/27) | Movement-barrier 409 misreported as a fresh travel failure (Icelocked) | 09-29 |
| [#26](https://github.com/Ryan-Haines/adventureland-party-console/issues/26) | AlData sale command lost across the realm-switch worker restart | 09-29 |
| [#24](https://github.com/Ryan-Haines/adventureland-party-console/issues/24) | Exchange job banks items on the auto-sell list | 09-29 · duplicate |
| [#22](https://github.com/Ryan-Haines/adventureland-party-console/issues/22) | Optimization attempt 2 | 09-29 |
| [#20](https://github.com/Ryan-Haines/adventureland-party-console/issues/20) | Merchant deliver-and-equip can’t self-correct after a disruption | 09-29 |
| [#17](https://github.com/Ryan-Haines/adventureland-party-console/issues/17) | Optional dashboard optimizations | 09-23 |
| [#16](https://github.com/Ryan-Haines/adventureland-party-console/issues/16) | ALClient routes skip the final-waypoint tolerance trim | 09-23 |
| [#15](https://github.com/Ryan-Haines/adventureland-party-console/issues/15) | Deliveries never scheduled when the recipient has no other work | 09-23 |
| [#14](https://github.com/Ryan-Haines/adventureland-party-console/issues/14) | Dashboard notice state set but never rendered | 09-23 |
| [#13](https://github.com/Ryan-Haines/adventureland-party-console/issues/13) | Realm switch requires a connected Steam character for headless rosters | 09-23 |

## Fork-only: not meant for upstream

### Agreed exceptions without an issue

`VINEXT_NO_DEV_LOCK` in the E2E fixture, and the release pipeline below. Decided 10-08: everything else in the fork is upstream’s code or backed by an upstream issue.

### Release pipeline points at the fork

[9a1ca84](https://github.com/Thefonze74065/adventureland-party-console/commit/9a1ca84), [854fe28](https://github.com/Thefonze74065/adventureland-party-console/commit/854fe28)

Keep these out of upstream PRs. The `Dockerfile` now conflicts with 1.4, which installs util-linux for the `flock`.

### Merge repairs

[3357f5e](https://github.com/Thefonze74065/adventureland-party-console/commit/3357f5e), [77cdaab](https://github.com/Thefonze74065/adventureland-party-console/commit/77cdaab)

No net change compared with upstream.

### Lint complexity refactors

[52e345b](https://github.com/Thefonze74065/adventureland-party-console/commit/52e345b), [d74fbbc](https://github.com/Thefonze74065/adventureland-party-console/commit/d74fbbc)

These belong with the features they split.

### Generated bundle drift

`characters/farming-zones.js` and `dashboard/lib/*.cjs` differ from upstream, but their TypeScript sources don't. Regenerate them.

### Discarded: escape attackers a character can outrun

[946a7bd](https://github.com/Thefonze74065/adventureland-party-console/commit/946a7bd), [b0a46d8](https://github.com/Thefonze74065/adventureland-party-console/commit/b0a46d8), [e67f6c7](https://github.com/Thefonze74065/adventureland-party-console/commit/e67f6c7)

Removed on 10-08 when adopting 1.4, because no upstream issue represents it. A faster character kept walking its path, and `afterCombat` got an escape option for event return, travel and party assembly.

This ledger was built from `git log upstream/bugfix-1.4..adopt/bugfix-1.4` (upstream at 9273ecb, merged as 400fb81), and all upstream issues #13–#131, comments and PRs as of 2026-10-16. Icelocked opened #28, #47, #59–#63 and #86, and [PR #131](https://github.com/Ryan-Haines/adventureland-party-console/pull/131) (replacing #89); comment on those rather than editing them.
