# Console store release cleanup failure inventory

- Windows recursive deletion can remove owner.json then fail ENOTEMPTY while a contender creates recovery files. Retrying deletion at operation.lock can erase a successor generation.
- Release must serialize with the existing recovery auditor, verify ownership before atomically detaching the whole generation, validate the detached store path, then retry only that immutable released path.
- Real filesystem evidence must prove action completion survives one declared transient cleanup failure, successor owner/files remain intact, and a live auditor claim is not deleted underneath its inspection. The transient I/O fault is injected at the filesystem cleanup boundary; all lock directories, rename, owner identities and successor store acquisition are real. No deployment or running store is touched.
