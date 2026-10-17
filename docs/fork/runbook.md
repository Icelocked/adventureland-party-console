# Fork maintenance runbook

Read this before touching the fork: pulling upstream, filing or reviewing upstream, or editing the ledger. It replaces the long-session context: follow it and keep it current.

## Policy

- The fork (`Thefonze74065/adventureland-party-console`, checkout `~/Projects/adventureland-party-console`) is **the maintainer’s code plus issue-backed code**. Adoption branches track the upstream branch being adopted: `adopt/bugfix-1.4` for `bugfix-1.4`, `adopt/1.5` (current) for `1.5-feature-branch`. Strongly prefer the maintainer’s solution: when upstream fixes something the fork fixed, take upstream’s version and drop the fork’s code, tests and docs for it.

- Agreed exceptions that stay fork-only: `VINEXT_NO_DEV_LOCK`, the fork release pipeline, plus the features in Fork-only and Matches (gear sets, gapped bank sort, Phoenix split search, boss guard in `runner.ts`, #31 market bank load, #34 WTB sort and Check). PR #25 was dropped for PR #104 by the user’s choice.

- Work only in the main checkout. Ask before creating worktrees or folders outside the repo; scratch exports go under `.build/` (ignored).

- The user starts/restarts the console and activates builds. Never touch the live install. Staged builds: source changes go live only through the dashboard reload/activation; `shared.js` no longer auto-publishes.

- Commit when asked or as part of an agreed fix; **never push** unless asked (see the fork head in [ledger.md](ledger.md)). End commit messages with the Co-Authored-By line from the session.

## Pulling upstream

- `git fetch upstream`; list `git log <adoption-branch>..upstream/<upstream-branch>`; dry run with `git merge-tree --write-tree --name-only HEAD upstream/<upstream-branch>`.

- Check open fork issues (`gh issue view N -R Ryan-Haines/adventureland-party-console`): commits that fix them replace the fork’s fix.

- Merge with `--no-ff`. For each conflict, list fork commits since the merge base touching the file. If only superseded fork fixes touched it, take upstream’s file. Otherwise resolve by hand, keeping fork features.

- **After resolving, diff every file the superseded fork commits touched against upstream** (`git diff upstream/<upstream-branch> -- FILE`): auto-merged leftovers and duplicated imports, fields or object keys survive outside conflict blocks. Twice a leftover line silently changed behavior.

- `playwright.config.ts`: take upstream’s lists and append missing fork specs before the list’s closing bracket; verify with `npx playwright test --project=live --list <fork spec>`. A wrong anchor once dropped ten fork journeys.

- Do not commit regenerated `characters/*.js` bundles; staged builds rebuild them. Keep `party-member.js` equal to upstream’s when its sources match.

- Verify: `npm run typecheck`; `npm run test:unit` compared by failing-test names against the previous run (12 known environmental failures as of 53a3cd6: game files 17175, `pwsh`, token catalog, cgoo fixture); then the live journeys nearest the change (Halloween, event-return handoff, gear sets, gathering cooldown, bank staging, exchange collection, Phoenix search, designated tank, bank sort gaps).

- Attribute a failure before calling it a regression: export upstream with `git archive upstream/<upstream-branch> | tar -x -C .build/upstream-check`, symlink `node_modules`, `dashboard/node_modules`, `.caracal/node_modules` and `.caracal/game_files` (never `localStorage` or `config.js`), build the runtime there, run the same test, then delete the export.

## Filing issues, comments and reviews

- Write as “I”, never “we”. No offers or questions. Give implementation details and code. Use upstream permalinks at a full SHA only; check every line number before posting.

- Never claim what wasn’t verified (a review once said “phone scanners I tried”; it had to be edited, via GraphQL `updatePullRequestReview` because REST returned 404).

- Fixes: write the failure inventory (`e2e/*-failures.md`) and the live E2E first, show it fails without the fix (control run), then fix. Never add unit tests after code; only update existing fixtures when a refactor requires it.

- Ask before posting anything upstream unless the user asked for it in that turn (“file it”, “post the review”).

- Reviews: comment when the PR is sound with minor notes; request changes for real bugs. Note conflicts with `bugfix-1.4` and with the fork.

## Keeping the ledger current

- The ledger is plain text in this repo: [ledger.md](ledger.md) (state per feature), [history.md](history.md) (dated log) and this runbook. It used to be a claude.ai artifact (`https://claude.ai/artifact/UapX9PWi2XeRBJe2sDaapL`), which is no longer updated.

- After every merge, filing, comment or review: add a dated entry at the top of `history.md`; move rows between sections of `ledger.md` (Matches = issue describes fork code; Done upstream = maintainer fixed it, fork took theirs; Update / comment = issue no longer matches the fork; Open upstream = untouched; Closed); update the ledger's header table (upstream base and merge commit, fork head, behind count, files differing, checked date), the status counts and the closing note.

- Compute numbers with git (`git rev-list --count HEAD..upstream/bugfix-1.4`, `git diff --name-only upstream/bugfix-1.4 HEAD | wc -l`); never write them before reading the command output. Recount each section's table rows or `###` items against the status table before committing.

- Commit ledger changes with the work they describe, or on their own as `docs(fork): ...`.

- Also update the memory file `fork-upstream-ledger.md` only for facts the ledger does not hold.

## Environment pitfalls

- The shell is zsh: `$VAR:path` applies modifiers (`:t`, `:r`…). Quote as `"${VAR}:path"`.

- Live coordinator API: `localhost:1924/party-api/state` (sections via `?catalog=0&dashboard=1&section=bank|market|core`). Read-only; never post to it.

- Live E2E: `npm test -- -- --project=live e2e/FILE --grep "..."`. Evidence lands in `.build/e2e-results/evidence/*/retry-0/` and is overwritten by later runs with the same test and repeat, so read it right away. Long runs go in the background.

- The E2E game image runs an older game build (client v15555, GAME_REV 90052162) than live (17665); its server source is readable via `podman run --rm --entrypoint sh <image id>`. The current public server is `kaansoral/adventureland_mongodb` (2148cf25).

- Fixture outcomes may be declared only at a boundary (e.g. the gathering roll hook in `live-gathering-cooldown.spec.ts`); everything else stays native.

- The live Playwright project lists its specs by name in `playwright.config.ts`; a new `e2e/live-*.spec.ts` runs nothing ("No tests found") until it is added there.

- An account can have only one merchant online (a second merchant is dropped right after login), and the game's merchant directory (`/api/pull_merchants`) lists only merchant-class stands. A live journey that needs another merchant has to declare it at that boundary.
