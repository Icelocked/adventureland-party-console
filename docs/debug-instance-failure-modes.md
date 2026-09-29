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

Before implementing the visual/client follow-up:
- Machine-specific font caches must not enter Linux images; both actual font
  families must load in the opened debug console.
- NPC cosmetic layers must survive map telemetry, including Dorr's head.
- Native animated map decorations must be present in the expanded viewer and
  use their real atlas frames, positions and anchoring.
- The game viewer must show and control the already-running client, without
  creating duplicate logins. Closing/reopening it must preserve the session.
- Remote display HTTP and WebSocket access require the debug private cookie
  and same-origin WebSocket requests. No display ports may be published.
- Stopping the debug instance must also remove its display and browser processes.
