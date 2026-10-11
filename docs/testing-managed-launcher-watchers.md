# Managed launcher watcher isolation

Failure inventory before implementation: persisted `watch_CODE: true` starts
the launcher's coordinator-file watcher; old `enable_TYPECODE` starts webpack
watching; worker/config imports bypass the managed policy; a build or installer
touch restarts workers; suppressing watchers alters persisted account data;
unmanaged native launches unintentionally lose their development watchers.

Exercise the actual installed native launcher in a disposable directory with
real filesystem changes and child coordinator processes. Managed launches must
retain their coordinator PID after its file changes; an unmanaged control must
restart, proving the change reaches the native watcher. Retain lifecycle PIDs,
launcher output and config observations. No live process is restarted by tests.
