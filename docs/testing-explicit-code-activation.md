# Explicit CODE activation validation

Managed headless workers must not install filesystem CODE watchers. Their only
update input is `CODE/adventure_land/activation.json`, atomically published by the
host after the selected files. Browser loaders consume the same record and ignore
manifest edits during periodic checks. Startup may load a standalone manifest,
but later manifest changes require an explicit activation record.

Failure inventory: no record, duplicate record, malformed record, unrequested
manifest edits, an occupied worker, another manifest edited during a busy retry,
explicit deployment, and rollback. Retain the selected manifest while retrying.
Keep stopped characters stopped and existing native reload acknowledgement checks.

Run the console scenario `managed headless generations` and native scenario
`native browser CODE ignores manifest edits`. The console scenario declares a
native worker IPC boundary, executes selected class files in a child process,
and records reload receipts. The native scenario uses actual upstream browser
CODE and status hashes, with declared host publication at its CODE HTTP boundary.
Also run native safe/immediate farming-and-defense resumption checks.

Activating this coordinator removes its watchers. The maintained host publication
change requires an explicitly requested host restart to replace the host module
loaded at startup. Building or pushing does not restart or deploy the host.
