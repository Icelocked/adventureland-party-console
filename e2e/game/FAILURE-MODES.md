# Disposable upstream game server: failure modes

Written before implementing the isolated server harness.

- Tests accidentally connect to a public realm or reuse a real account. Bind the
  stack to loopback, use fixed disposable accounts, and reject nonlocal endpoints.
- Bootstrap runs before MongoDB is ready, or partially initializes a database.
  Wait for database readiness and make initialization repeatable.
- An upstream update changes gameplay without review. Pin every source revision.
- Authentication succeeds but socket admission, character persistence, map data,
  collision data, or simulation timers fail. Readiness must include authenticated
  characters admitted by the real simulation, not just an HTTP 200.
- Locally registered accounts lack email/platform verification and are admitted
  with authfail/notverified penalties, silently invalidating kill and reward
  journeys. Seed explicit local account entitlement and record it in the manifest;
  never contact Steam or reuse public account credentials for fixture admission.
- Test setup replaces gameplay with mocked movement/combat/inventory events.
  Seed only initial database state; all tested gameplay uses upstream handlers.
- Cross-test state, leftover processes, or timing-dependent random outcomes make
  reruns disagree. Reset disposable data between runs and assert bounded outcomes,
  recording before/after state and server logs in artifacts.
- Recreated game containers inherit a fresh-looking realm lease and connected
  character records after Docker terminates the old simulation. Clear those
  leases only in the hardcoded disposable database before launching either server.
- Docker cleanup stops unrelated services or deletes production data. Use an
  explicit project name and only project-owned containers and named volumes.
- A passing browser screenshot conceals rejected actions. Assert authoritative
  socket and persisted state as well as visible application results.
