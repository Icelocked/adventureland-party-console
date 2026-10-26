# Method

How the plan proves it has no gaps, and how the rebuild proves it lost no
functions. Feature specs under `docs/specs/` describe behaviour; this file
and the rest of `docs/implementation/` describe how the work is checked.

## Sources

- Ryan's base: his `1.5-feature-branch` at `b9b5c91e` (2026-10-22), the ref
  `refs/review/ryan-1.5` in the review checkout
  (local checkout).
- The user's fork: `af92de45` (topic15r/release-ui) plus the death fixes at
  `21b8362d`.
- The first and full reviews: (local checkout)
  and `review/full/`.
- Game rules: the game server source (kaansoral/adventureland_mongodb) and
  game data.

## Completeness is checked by tools, not by reading

1. `tools/function-index.mjs` lists every named function in Ryan's
   hand-written code: `catalog/functions-ryan-1.5.json` holds 7,857 functions
   in 987 files. Generated bundles are listed under the source they come
   from.
2. Each spec's catalog file `catalog/<NN>-<part>.json` claims functions for
   its behaviours: `{ "behaviours": [{ "id", "summary", "functions": [...],
   "tests": [...] }] }`.
3. `tools/check-claims.mjs` fails if any function is claimed by no spec, by
   more than one spec, or names a function that does not exist. A function
   that only serves plumbing (a logger, a formatter) is still claimed, by the
   behaviour it serves.
4. The same tool lists every behaviour with no test. Each one gets a test or
   a written reason before its spec is done.

A spec's "Gaps" section lists whatever the tool reports for it. A spec is
done when that list is empty.

## Proof of function: Ryan's tests

Ryan's suite is the main proof that the rebuild keeps every function:
350 end-to-end tests in 105 spec files (plus 22 shared case files) and 3,024
unit tests in 453 files.

1. **Baseline.** Run the whole suite on Ryan's base and record every result,
   including the tests that already fail or hang, and why.
2. **Review the tests for accuracy.** For each test: does it prove what its
   name says, does it pass for the right reason, and does it match how the
   game actually works? Inaccurate tests are fixed or flagged before they are
   trusted as proof.
3. **Map tests to behaviours.** Every test points at the catalog behaviours
   it proves. A behaviour with no test is a gap. A test that proves nothing in
   the catalog is either testing a patch (a guard between two systems) or
   showing a behaviour the catalog missed; the second is a catalog gap.
4. **Run the same suite on each new owner.** Every behaviour test must still
   pass. Tests that must change because a behaviour changes on purpose are
   rewritten together with the spec's "What changes for the player" entry,
   and the old and new results are shown side by side so the improvement is
   visible.
5. **Prune redundancy last.** Once the owners exist, tests that only guarded
   a removed patch, or that prove the same behaviour as another test, are
   retired. Every behaviour keeps at least one proof, preferably end-to-end.
   Each retirement is listed with the test that still covers its behaviour.

End-to-end tests stay the main proof. Unit tests cover an owner's rule table
directly and stop slicing single functions out of `characters/shared.js`.

## Every test is defined, measurable and labelled

A test states what it proves before it runs, and its result is a measured
value against a set threshold, never a random outcome read afterwards.

- **Label:** the catalog behaviours it proves, and the gaps it does not
  cover (for example "level 1 monsters only", "no other players").
- **Setup:** fixed and written down: map, monsters, gear, settings, seed or
  spawn control where the game allows it.
- **Measure:** named values with a pass threshold, for example "priest basic
  attacks while a party member is under 90% HP: 0", "longest time a member
  spends more than 200 units from its group: under 5 s".
- **Invariants checked every tick,** not only at the end: the run fails the
  moment a rule breaks and records the state that broke it.
- **Outcomes like deaths are reported with a cause,** classified as gear or
  stats, monster ability, or code behaviour, never as a bare count.

## Preventing mistakes in the plan itself

Reviews and specs are written with agents, and agents make mistakes: wrong
line numbers, wrong counts, explanations that sound right and are not. The
plan guards against that the same way it guards the code.

- **Every number names the command that produced it,** so anyone can rerun
  it. A number without a command is not used.
- **Every claim cites file and line in a fixed ref.** A separate check opens
  a sample of citations (all of them for rule tables) and confirms them.
- **Two independent passes on the parts that matter most.** Rule tables,
  causal chains and "what changes for the player" are written by one pass
  and verified by another that tries to prove them wrong. Disagreements are
  resolved against the code, not by vote.
- **Inference is labelled as inference** and is never the basis for a
  design decision until it is confirmed by code or a test.
- **Corrections are tracked.** When a check finds a wrong claim, the claim
  is fixed and the same mistake is searched for across all specs.
- **The user signs off the rule tables** (who wins, what waits, what
  resumes), because they decide how the party should behave.

## Proof of efficiency

Each owner is measured before and after on the same workload, with the
numbers kept next to the spec:

- **Console cost:** CPU time per character tick and per coordinator tick,
  memory, persistence writes per minute, dashboard payload size and poll
  cost. Ryan's benchmark tools (`tools/benchmark-persistence.mts`,
  `tools/benchmark-metrics-journal.mts`, `scripts/benchmark-dashboard-*.cjs`)
  are the starting set.
- **Game cost:** calls per 4 s against the game's limit, by call type, and
  route plans per minute.
- **Play results:** kills per hour, time lost to stalls and regroups, and
  deaths with their causes, on the same farm and setup.

The comparison mode used before an owner takes over runs both the old and
new decision, so it costs extra while it runs; it is measured separately and
removed after.

## Proof on real play

Before an owner takes control, it runs beside the old code on the live party,
decides but does not act, and logs every decision that differs from the old
code. Each difference is resolved as a bug in the new owner, a bug in the old
code, or an intended change already listed in the spec. The owner takes
control when the list is empty, and the comparison code is removed after.

## Who checks

The work that writes a spec or builds an owner does not sign it off. A
separate check reruns `check-claims.mjs`, the test mapping, and the
comparison logs, and reports their raw output.
