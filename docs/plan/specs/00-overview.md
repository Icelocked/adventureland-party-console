# Party Console Redesign: Overview

## What this is

A plan to rebuild the core of the current Adventure Land party console so
that every decision has one owner, the console behaves the same or better
for every feature it has today, and optional features plug in as add-ons
instead of living in forks that patch the core.

This folder is the plan. Each numbered spec covers one part of the console:
what it does today (every behaviour, traced to code), what goes wrong and
why, the design that replaces it, and how we prove nothing was lost. This
overview ties them together.

## Why this exists

The console works, but its bugs keep coming back in new shapes. A review of
The current console and the fork built on it found the
same cause behind most of them: several parts of the code make the same
decision for the same character, and nothing decides which one wins. Fixes
then add a flag, a timer or a special case so one part stops overriding
another. Both histories show it: in the base, most of the 265 gameplay bug
fixes (from every contributor, the fork's PRs included) add a guard, a
special case, a retry budget or a recovery path, because there is no owner
to fix. The fork shows it more sharply: pull mode needed 8 fixes in two
days, Achievement Hunt 20.

Patching symptoms one at a time keeps the console running, but every patch
adds another rule that the next feature has to work around. The redesign
fixes the ownership gaps themselves.

## What the review found

The review read the current console (682 commits to b9b5c91e) and the fork (239
commits) function by function (`git rev-list --count`; the per-commit
tables are in the review notes, not in this folder). The same six patterns explain most of what
goes wrong, in the current code and in ours alike.

1. **Many parts move the same character.** Movement has 249 call sites in 130
   functions (plus 2 top-level lines), 102 of them `stop()`, and a bare, `move` or `smart` stop ends whatever
   journey is live, whoever started it (spec 02, movement.ts:411). The fork's pull walk
   re-sent its move every tick, and the priest stood still for 400 s
   (3365dd57).
2. **One fact is worked out in many places.** "A member is at an event" is
   computed in 33 places (spec 01 GRP-013). Escape and death recovery each
   define "safe", so after a death the party can wait at a Blink landing
   that recovery never accepts (spec 05 bug 5).
3. **Shared resources have many writers.** The merchant's realm has 13
   writers: the full review listed nine and spec 09 found four more. Six
   writers share the potion cooldown, one of them from the fork, so the
   server refuses the second potion with "not_ready" (spec 03 bug 13,
   spec 05).
4. **A setting is declared by hand in many lists.** Each of the 119 saved
   fields sits in 2 to 9 hand-kept lists, 73 of them in 5 to 8 (spec 11).
   A field missing from the save list is lost at the next restart.
5. **Calls share one budget that nobody owns.** The game disconnects a socket
   whose calls pass 200 in 4 s; 13 per-listing Ponty reads inside 4 s cost
   208 (16 each, matching the logged disconnect), and nothing on the merchant checks the budget first (spec 09 ledger
   12). The fork's Ponty pacer counts only its own calls. The dashboard has the same gap:
   in the default shadow mode the 250 ms fallback poll ships every stored
   field, including the combat trace: about 157 KB per character against 9 KB in
   enforce mode, from a saved four-character state (docs/state-field-registry.md,
   section Speed).
6. **Fixes add guards, not owners.** In both histories most bug fixes add a
   flag, a timer or a special case so one part stops overriding another,
   because there is no owner to fix. The fork is the clearest example: 64
   fix commits on its own code (11 of them lint refactors), pull mode 8 in
   two days, Achievement Hunt 20, Pause 3, plus 27 `typeof` guards added to the shared character code
   (spec 13 LIF-W5).

The fork's patchwork is part of the finding. Its features were built beside
the current code instead of through shared owners, because the console has no
owners to register with yet, and they needed more fixing than the code they sit on.

What this costs players:

- **Stalls.** The warrior held 405 s for a pulled monster that stopped short
  (c13ff2d1). Hunt stays stuck after a death until someone acts
  (spec 05 bug 5).
- **Deaths.** 127 of 127 priest attacks while a member was under 90% HP went
  out instead of a heal (spec 03 bug 3a). An escaping mage drank MP at 531 of
  1873 HP and died to the next hit (spec 05). A fork event walk left two
  members behind and the leader died alone at Mr. Pumpkin (spec 02, 653238e1).
- **Disconnects.** Merchant call bursts pass the 200-per-4-s limit (spec 09).
- **Wasted event time.** Fighters stood at the Witch for a whole Cipher drop
  window (spec 06 section 2.4, e9e4bda3). Staging pauses Hunt 120 s before
  spawn (spec 06 section 2.3), and a rejected join is retried every 10 s
  while Hunt waits (section 2.2).

The first fixes are the death fixes on the fork (21b8362d): the priest
heal fix (648b3be0) targets the cause of the 127 of 127 count above,
and the Cipher fix (e9e4bda3) sends fighters to gather instead of waiting.
Their after-fix measurements are not yet recorded in a spec with the command
that produced them, so this page gives no numbers for them until they are.

## Principles

- **One owner per decision.** Where a character moves, which cooldown it
  spends, what it attacks, what its group is doing, which realm the merchant
  is on, and what each setting's value is: each has exactly one owner.
  Everything else asks that owner.
- **Written rules, not flags.** Each owner decides from a rule table that a
  person can read, test, and change in one place. When two requests compete,
  the table says who wins and what happens to the loser (wait, resume, or
  cancel).
- **Groups, not "the party".** A group is any set of characters doing one
  task together. A full party is a group, a character farming alone is a
  group of one, and the merchant is its own group. Each group has its own
  task owner. Movement, turns and cooldowns belong to each character
  whatever group it is in.
- **No lost functions.** Every behaviour the console has today is listed in
  a catalog, traced to the code that does it, and covered by a test. The
  rebuilt console passes the current tests, and every intentional change is
  written down as a change, never left as a side effect.
- **Owners are core design; add-ons are for third parties.** Core features
  keep being written the way they are now: as ordinary core code that uses
  the owners like any other part of the core. Nothing in the core has to be
  built as an add-on. Add-on hooks exist so that anyone extending the console
  can do it without breaking how the existing code works: a hook accepts a registration (a task, a move request, a target
  rule, a merchant job type, a setting, a dashboard panel, a status line)
  and the owner applies it under its own rules. Any add-on can be merged
  into the core if it proves useful there.
- **One owner at a time.** The core changes in steps, each one shippable and
  reversible. A new owner runs beside the old code and compares decisions on
  real play before it takes over.
- **The same rules everywhere.** The owners are not only bug fixes. Any
  system that makes shared decisions follows the same pattern, even where no
  bug has shown up yet, so future features land in the same structure.
- **No efficiency regressions.** The efficiency work already in the console
  (the current console and #148: fewer requests, smaller dashboard payloads, cheaper
  persistence) is a floor, not a starting point. Every owner is measured
  before and after against the same benchmarks, and an owner that costs more
  than the code it replaces does not ship until it is fixed.
- **Function without bloat.** Every design choice is weighed as what it
  makes work against what it adds: code, state, calls, time per tick. The
  simplest structure that does the job wins. A rule table only holds rules
  the console applies, and an owner holds only the state it decides from.
- **Hooks are always there, and free when unused.** Each owner exposes its
  hooks at its decision points from the start, so an add-on never has to
  edit core code to plug in. With nothing registered, a hook is a check of an
  empty list and the owner takes its normal path, so it costs next to
  nothing. Hooks sit at owner decision points, not scattered through the code.
- **One hook registry, the same way as the field whitelist.** Every hook is
  declared in a single registry file (name, owning part, what it receives,
  what it may return), the same pattern as the state field registry and its
  fork whitelist. Adding a new hook means one entry there plus one call at
  the owner's decision point. An add-on lives in its own folder and is
  enabled by one line in the add-on list, so turning one on or off never
  touches core files.
- **Two kinds of hook, no more.** A notice tells add-ons something happened
  and cannot change the outcome. A request goes into the owner's existing
  rule table like any core request, with a priority the core caps so no
  add-on outranks escape or death recovery; when several add-ons ask, the
  rule table decides exactly as it does for core requests. No separate
  merge rules, ownership claims or bookkeeping are added for add-ons; a new
  kind is added only when a real add-on needs it.
- **Every log has a limit.** Decision records live in a fixed-size buffer
  per character in memory, so the newest replace the oldest. Records are
  saved to disk only when something goes wrong (a death, a stall, a failed
  task) and those saved records are pruned by age and count. The comparison
  logs used during a switch-over are deleted with the comparison code. No
  store grows without bound, as `production.attempts` did (the current #59).
- **Clear the noise, then the numbers.** Once handling bugs stop masking
  them, wrong values, typos and game-rule mismatches become visible. Each one
  found during the review is fixed or listed in its spec, not deferred.
- **Explain every change in plain terms.** Each change comes with a short
  write-up that anyone, or the agent they work with, can check on their own:
  what goes wrong today with evidence, what the change does, which tests
  prove nothing was lost, and what improves. A change that is not taken
  upstream still has to stand on its own.

## Working together

This plan builds on the current console, not around it: it follows upstream
updates for fixes and ideas, compares approaches for efficiency, and offers
changes that measurably improve the console. Preference changes (layout,
wording) are offered as options, never argued. A change that is not adopted
upstream stays in the fork, and the fork keeps taking upstream updates.

## The parts

| Spec | Part | Owner it defines |
|---|---|---|
| [01](01-groups-and-tasks.md) | Groups and tasks | What each group is doing, and which task wins |
| [02](02-movement.md) | Movement | Where each character moves, and who may stop it |
| [03](03-turns-and-cooldowns.md) | Turns and cooldowns | Which action spends each shared cooldown |
| [04](04-targeting.md) | Targeting | What each character attacks or avoids |
| [05](05-survival.md) | Survival | Heals, potions, escape and death recovery |
| [06](06-events.md) | Events | Event schedules, travel, joining, attendance and returns |
| [07](07-hunts-and-farming.md) | Hunts and farming | Monster Hunt, farming modes, farm areas, rares, Cave |
| [08](08-merchant-jobs.md) | Merchant jobs | Which job the merchant runs and what interrupts it |
| [09](09-merchant-realm-and-gear.md) | Merchant realm and gear | Which realm the merchant is on, what it holds |
| [10](10-inventory-bank-commerce.md) | Inventory, bank and commerce | Items, banking, upgrades, markets, Ponty and Ron |
| [11](11-settings.md) | Settings | Every saved value: one registry, one writer |
| [12](12-dashboard-and-status.md) | Dashboard and status | What the dashboard shows and where status text comes from |
| [13](13-lifecycle.md) | Lifecycle | Start, stop, deploy, pause, code reload and the character loader |
| [14](14-add-on-hooks.md) | Add-on hooks | The registration API each owner exposes |
| [15](15-testing.md) | Testing | Proof of function: the current tests, the catalog, and pruning |

These parts are not independent. A group's task drives movement requests,
targeting feeds turns, survival can take movement away from any task, and
settings and status run through everything. Each spec names the owners it
asks and the owners that ask it.

## How each spec is laid out

1. **What it does today.** Every behaviour, numbered (for example `MOV-014`),
   with the functions and files that implement it. Every function in the current
   base belongs to exactly one spec's catalog; `catalog/` holds the proof.
2. **What goes wrong.** Each known bug and patchwork pattern in this part,
   with its causal chain and the commits that patched it.
3. **The design.** The owner, its rule table, its inputs and outputs, and
   the hooks it exposes.
4. **What changes for the player.** Every behaviour that changes on purpose,
   with the reason. Anything not listed here stays the same.
5. **Proof.** The tests that show each behaviour still works and each fix
   holds: the current existing tests, plus new tests where a behaviour has none.
6. **Migration.** The steps to replace the old code with the owner, what can
   be deleted after, and how to roll back.
7. **Gaps.** Must be empty before the spec is done.

## Ground rules while the plan runs

- **The current code keeps moving.** The catalog and the function index are
  rebuilt on the latest upstream branch at a regular interval, and every spec notes
  the ref it was checked against. Upstream changes are read for fixes and ideas,
  and the plan absorbs them rather than freezing on an old version.
- **Feature freeze.** No new features or fork additions until the plan is
  done. Only urgent, game-breaking bugs are fixed meanwhile, and each such
  fix is recorded in the spec it touches.
- **Game bugs go to the game.** When a problem is in the game itself, it is
  reported through the game's own channel with a clean reproduction that
  rules out console code: the smallest script or plain client steps that
  show it, on the current console or with no console at all.
- **New code will have bugs.** Each owner ships with its comparison log,
  its tests and a rollback. A bug in new code is traced to the rule or input
  that caused it, fixed at the owner, and gets a test, the same standard the
  plan holds the old code to.
- **Reviews the user owns** are listed in a separate review queue:
  every rule table, every "what changes for the player" entry, and every
  call that needs a decision on how the party should behave.

## Milestones

- **M0: the map.** Every spec's "what it does today" section is complete and
  every function in the current console is claimed. Every test is mapped to the
  behaviours it proves.
- **M1: the designs.** Every owner's rule table and hooks are written and
  reviewed together upstream.
- **M2 onward: one owner per milestone,** in the order set in
  `docs/implementation/04-migration-order.md`, smallest and most
  bug-removing first.
