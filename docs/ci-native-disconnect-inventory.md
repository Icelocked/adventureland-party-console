# Native disconnect observation failure inventory

Before implementation: Pumpkin threshold proof 38337327918 retired the priest frame for more than the existing 30-second observer deadline after a genuine primary socket disconnect. Trace records Steam recovery and subsequent native reload, but the disconnect reason was lost because the event ledger is harvested only when the native frame can still be read.

Failure boundaries: observations must survive document/frame retirement, remain bounded and per character, avoid full URLs/query credentials and socket authentication IDs, preserve native disconnect/reload behavior, and never fabricate connection events or turn a missing frame into success. Binding failures must not throw into native Socket.IO dispatch. No readiness retries or production recovery semantics are changed.

The existing canonical native observer will send a small actual disconnect snapshot through a unique Playwright page binding to a Node-owned journal. Fixture teardown attaches that journal without requiring a current game frame. Fields contain the raw string reason, observer/socket generations, actor, connection flag, native reload settings, manual CODE-stop flag, pathname, and already-present CODE return-cycle identity.
