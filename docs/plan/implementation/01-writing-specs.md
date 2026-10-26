# Writing a spec (milestone M0)

M0 is the map: for each part of the console, everything it does today and
everything that goes wrong, with every function in Ryan's base claimed.
Designs come in M1. Read `docs/specs/00-overview.md` and
`docs/implementation/00-method.md` first.

## Inputs

- Ryan's base: `refs/review/ryan-1.5` in `F:/CodingProjects/pm-worktrees/review`
  (read with `git show refs/review/ryan-1.5:<path>`, `git grep ... refs/review/ryan-1.5`).
- The fork: `HEAD` (af92de45) in that checkout, and the death fixes at
  `21b8362d` in `F:/CodingProjects/pm-worktrees/pta-pull`.
- Reviews: `F:/CodingProjects/backups/party-console/review/full/*.md` (full
  pass) and `review/*.md` (first pass). Treat both as leads to verify, not
  as facts. The movement and combat full reviews are thinner than the rest.
- Function index: `catalog/functions-ryan-1.5.json` (7,857 functions; id =
  `file#scope>name@startLine`). Starting split: `catalog/proposed-sections.json`
  (a path and name heuristic; 793 are "triage").
- Tests: `e2e/*.spec.ts`, `e2e/*.case.ts`, `scripts/tests/*.test.cjs` on the
  same ref.

## What to produce

1. `docs/specs/NN-<part>.md` with these sections, in plain language a
   non-programmer can follow (code detail only where needed to be exact):
   1. **What it does today.** Every behaviour, numbered `<PREFIX>-001`
      onward, each with a one-line description, the rules it follows, and the
      settings that change it. Group related behaviours under headings.
   2. **What goes wrong.** Each known bug and each patchwork pattern, with a
      causal chain (file:line at each step, on the fixed ref) and the commits
      that patched it. Include wrong values, typos and game-rule mismatches
      found along the way.
   3. **Fork differences.** What the fork adds or changes in this part, and
      what each addition patches.
   4. **Tests today.** Which tests cover which behaviours, each test labelled:
      what it proves, what it does not cover, whether it is accurate, and
      whether it only guards a patch.
   5. **Needs your review.** Questions only the user can answer (how the
      party should behave). Every question has three parts, in this order:
      **Today:** how Ryan's base handles it now (and the fork, if different),
      with file:line. **Options:** the realistic choices with trade-offs.
      **Recommendation:** the answer we suggest and why, in plain words. The coordinator copies them into
      `REVIEW-QUEUE.md`; don't edit that file, since several specs are
      written at once.
   6. **Gaps.** The output of `node tools/check-claims.mjs` filtered to this
      spec, plus anything not yet verified. M0 is done when this is empty.
   Sections 3 to 7 of the overview layout (design, player changes, proof,
   migration) are left as headings marked "M1".
2. `catalog/NN-<part>.json`: `{ "ref": "b9b5c91e", "behaviours": [{ "id",
   "summary", "functions": [function ids], "tests": ["file::test name"] }] }`.
   Claim every function in the proposed list for your spec. A function that
   belongs elsewhere goes in `catalog/handoffs-NN.json` (your spec number) as
   `{ "id", "from", "to", "reason" }` instead of being dropped. Claim triage
   functions that belong to your part.
3. Run `node tools/check-claims.mjs` (it covers all specs; filter its output
   to yours) and paste the counts for your spec into its Gaps section.

## Rules

- Every number names the command that produced it. Every claim cites file and
  line on `refs/review/ryan-1.5` (or the fork ref, labelled).
- Inference is labelled as inference.
- Read code in full; do not sample. If context runs low, write what you have,
  list what is left in Gaps, and continue.
- Plain words, active voice, no em or en dashes, current state only (no
  "previously" narration).
- Read only for the console repos: no edits, builds, live tests or containers.
  Write only inside `F:/CodingProjects/party-console-plan`.
