# Cave debug instance start and cleanup: failure inventory

Written before the change (2026-10-13, Settings → Cave of Many Dreams debugging on a
Podman host). Live journey: `e2e/debug-instance.spec.ts` (project `debug`).

1. **Startup import.** The debug console runs `node tools/debug/instance.mts`, which
   loads `e2e/live-game-client.ts` with Node's own TypeScript support. Since upstream
   d505e5e it imports `./native-graphics-diagnostic.js`; Node does not map `.js` to the
   `.ts` file (Playwright's loader does), so the container exits with
   `ERR_MODULE_NOT_FOUND` before the god party connects.
2. **Cleanup order.** The game and console containers share the database container's
   network (`--network container:<project>-database`). `destroy()` removes every
   labelled container in one `rm -f -v` call; Podman refuses to remove the database
   while its dependents exist ("has dependent containers which must be removed before
   it"), so cleanup fails and the database stays running until Stop is pressed again.
3. **Readiness.** (Found after fixing 1.) Startup waited for the container's
   `State.Health` to be `healthy`, but Podman builds OCI images by default and drops the
   image's `HEALTHCHECK` ("not supported for OCI image format"), so a ready console
   timed out after five minutes. The timeout also gave no console output, because the
   failed stack is destroyed.
4. **Leftovers.** After Stop, no container, volume, network or image labelled for the
   debug project remains.
5. **Docker parity.** The same removal works with the Docker CLI.
