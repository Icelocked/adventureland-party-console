# Linux dependency-cache install and update

Failure inventory, recorded before implementation for #102:

- Fresh isolated npm installations create `.bin` links rejected by the store.
- A completed but linked legacy cache is reused on every retry.
- Changing install flags without changing the cache identity reuses that cache.
- A staged update replaces the running dashboard before explicit activation.
- An explicit update fails verification or serves the previous dashboard.
- Relaxing verification admits arbitrary links or follows external targets.

Run `RUN_DOCKER_DEPENDENCY_UPDATE=1 npm test -- -- --project=console
e2e/console-build-docker-dependencies.spec.ts`. Docker is required. The test
builds the maintained development Docker install from a compiling source snapshot
with the exact pre-fix builder from c372335, then copies only the current maintained
builder into its disposable container. The source snapshot includes tracked
working changes, since that committed snapshot alone lacks an unrelated upgrade
UI export. The E2E reproduction patch records those changes.
It mounts neither the checkout nor account data and supplies no credentials.
Hidden npm lock metadata is removed only inside the container to exercise the
reported fallback `npm ci` path rather than installed-tree copying.

Two old-code attempts must reproduce the link rejection and retain the same
completed cache. Current code must build and verify a different dependency cache,
serve the real compiled dashboard, build a visible dashboard update without
changing the served page, and explicitly activate it through the maintained
deployment route/controller/driver. Game lifecycle ports fail if called: this
is a dashboard-only update with no game account. Legacy cache cleanup may be
deferred because its links remain deliberately forbidden.

Artifacts retain Docker build/command logs, old-cache rejection and link census,
candidate identities, deployment journal and before/after dashboard HTML.
