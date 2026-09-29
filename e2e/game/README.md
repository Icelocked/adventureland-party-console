# Disposable Adventure Land server

`npm test` provisions this stack automatically through Playwright global setup,
collects server logs at the end, and removes its containers and disposable volume.
`npm run test:e2e:console` runs the separate console project without Docker.
Set `E2E_KEEP_GAME=1` only when debugging repeated selected live journeys; finish
with the scoped `down` command below. The default run never retains game data.

`node e2e/game/manage.mjs up` builds pinned upstream code, starts an isolated MongoDB
replica set, seeds the upstream map geometry, starts the Express and Socket.IO game
servers, and registers disposable characters through the real account API.

The stack requires Docker Compose. Its project is `al-e2e-pr21`. Only loopback web
port 8083 and socket port 9003 are exposed; MongoDB stays private. Never point this
harness at production. Credentials are intentionally public disposable test values.

`node e2e/game/manage.mjs logs` records the server logs in `.build/e2e-live/`.
`node e2e/game/manage.mjs down` removes only this Compose project's containers and
its database volume. A subsequent `up` recreates a clean game world.
When Docker recreates only the game container during development, its boot script
clears stale realm and character connection leases in `al_e2e` before starting the
upstream processes. This avoids upstream's twelve-minute duplicate-server guard
after an interrupted container shutdown.

`bootstrap.cjs` exports `bootstrap`, `reset`, and `admin`. The native upstream admin
endpoint supplies initial state and reads authoritative results. The actual client
and socket handlers perform movement, combat, inventory, parties and all other
tested gameplay. `reset` requires the previous browser clients to have closed.

The upstream game code is not modified. Initial characters receive level 80 and
test currency so each journey can exercise its feature without hours of grinding.
Their initial items and locations are restored between journeys. Tests must choose
outcome assertions appropriate for genuine random combat and upgrade results.
The disposable account is also seeded as verified, with upstream's legacy web
access flag and a local entitlement marker. Upstream requires verified platform
ownership for ordinary rewards; the marker supplies that local fixture prerequisite
without calling Steam or representing a public account purchase. Gameplay handlers
and their eligibility checks remain unchanged. The seed artifact records this state.

Source pins and the Node base image digest are recorded in `Dockerfile`; the two
package lock files pin upstream Node dependencies, installed with `npm ci`.
The game license is
[AdventureLandOnlyUse](https://github.com/kaansoral/adventureland_mongodb/blob/90052162eb3ebda36c893e1eb4af643913c8f984/LICENSE);
Adventure Land is by Kaan Soral: https://adventure.land.
