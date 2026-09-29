# Harness failure modes (written before implementation)

These original cases describe the `console` project. Native game failure modes
and real execution are documented under `e2e/game/`.

- Reusing a developer server can test stale code or mutate live state. Every run owns its processes, ephemeral ports, and a fresh directory under `.build/e2e`.
- Reloading the page alone does not prove durability. Restart the real coordinator with the same journal and read the restored state.
- Mocking dashboard requests can hide route, serialization, gateway and persistence failures. Browser requests pass through the production gateway to the built coordinator.
- A crashed child can leave a hanging test. Bound readiness and shutdown, capture child output, and fail on early exit.
- Passing tests without evidence are hard to reproduce. Keep traces and screenshots on success as well as failure, plus state, logs, dependency hashes and a run manifest.
- Public game services and local credentials are outside this deterministic suite. Supply explicit account/game fixtures, restrict browser networking to loopback, and document that movement/combat outcomes remain uncovered.
- Cleanup must not kill unrelated processes or delete user data. Stop only child handles owned by this run; keep journals as artifacts rather than deleting directories.

## Evidence audit, before strengthening verification

- Matching result counts can conceal a duplicate outcome replacing a missing
  selected scenario. Verify exact scenario identities as well as counts.
- Host dependency hashes do not identify the upstream server dependencies.
  Include both Docker-installed upstream dependency lockfiles in the manifest.
- Reading revision or dependency metadata at completion can attribute a long run
  to source changes made after its reproduction patch was captured. Capture all
  source provenance at the same start boundary; freeze source during verification.
