# Native reconnect frame identity failure inventory

- Reconnect deliberately removes the original companion frames. A dynamic current-frame getter cannot identify those removed frames afterward and correctly reports temporary absence.
- Capture actual original Frame objects before issuing the stop/restore operation; require every captured frame to detach before launching replacement observers.
- Preserve native ownership guards, actual bridge restore, replacement readiness, convoy destination and final character assertions. Existing lost-follower native E2E is the behavioral regression and must rerun in CI.
