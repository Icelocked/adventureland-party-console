# E2E failure modes

## Coordinator host (recorded before implementation)

- A green UI-only test can hide broken coordinator route registration, request parsing, or persistence. Run the built application with real Express and its real JSONL store.
- Restart can lose acknowledged settings. Reuse the same isolated journal across process restarts and inspect the restored HTTP state.
- Fixtures can accidentally load local credentials, launch real characters, migrate live storage, or contact the public game. Supply the account/game adapters explicitly, run in an isolated data directory, reject character launches and external transport, and never load installed caracAL configuration.
- Startup catches exceptions internally and can leave a listening but incomplete server. Treat logged startup errors as fatal and report readiness only after application startup and a successful state request.
- Concurrent runs can corrupt shared storage or reuse a stale service. Require a dedicated data directory and use the production writer lock; the runner must own its child process and port.
- A synthetic server cannot prove native movement, combat, purchasing, or live server compatibility. Label the fixture boundary explicitly and retain unique ownership/race/recovery regression tests until an E2E journey exercises those failures.
- A browser reload can conceal missing disk persistence by leaving the coordinator alive. Restart the coordinator process in the persistence journey.
