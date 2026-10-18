# E2E dashboard candidate environment: failure inventory

Written 2026-10-18. Since upstream 3ddec7d, global setup (`e2e/game/setup.mjs`) publishes the verified
dashboard candidate to workers and reporters as `E2E_DASHBOARD_CANDIDATE`. Journeys: any live or console
spec; the control is the run of 14 live journeys on 98f25b5 (fork merge of 3ddec7d), which failed in setup.

1. **E2BIG on Linux.** The variable holds the whole manifest, including a SHA-256 for every file in
   the release (about 248 KB here). Linux caps one environment string at 128 KiB (`MAX_ARG_STRLEN`),
   so the first child process setup starts (`tools/sim/setup.mts`, or later the game and coordinator)
   fails with `spawnSync node E2BIG` and no test runs. Upstream's CI run 39106754340 fails the same way.
2. **Dashboard fixture loses its candidate.** `e2e/fixtures.ts` needs `directory`, inside
   `.build/console/releases/`, to start the built dashboard; a smaller variable must keep it.
3. **Run provenance loses its candidate.** `e2e/artifact-reporter.cjs` records `manifest` in `run.json`,
   and `tools/sim/e2e-benchmark.mts` compares its `sourceHash` and `components`; both must stay.
4. **Verification weakened.** Setup still verifies every file hash against the release before
   publishing the summary; dropping `files` from the variable must not skip that.
