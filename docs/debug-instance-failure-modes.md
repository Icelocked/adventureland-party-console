# Disposable debug instance failure modes

Before implementation, validate these boundaries:

- Missing Docker CLI or inaccessible engine: actionable error, retry available.
- Duplicate clicks, browser reload and concurrent tabs: one owned stack and state.
- Stop during a build/start: cancel startup, then remove only owned resources.
- Partial startup or parent restart: recover the recorded stack; permit teardown.
- Teardown failure: retain ownership and show error; never report stopped early.
- Port collision: let Docker allocate an unused host port, separate from production.
- Running inside Docker: use engine API through the Docker CLI, streamed build
  contexts and named volumes; never assume host paths match container paths.
- Isolation: no production session, account, database, CODE directory or ports.
- Access: existing Settings authentication/CSRF checks protect control; a private
  link authorizes the disposable console, with no public game/admin ports.
- God seed applies before login. Native Cave Dev mode permits repeated visits;
  verify entry, exit and second entry through the real clients and game server.
- Stop removes containers, network and all instance volumes/data. Reusable build
  images may remain cached, but must contain no account or runtime state.
- Browser or child-process failure must not leave a false running state.
- New starts after teardown get fresh state. Tests retain screenshots, native
  observations and resource inventories as repeatable evidence.
