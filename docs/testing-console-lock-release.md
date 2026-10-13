# Console store release cleanup failure inventory

- Windows recursive deletion can remove owner.json then fail ENOTEMPTY while a contender creates recovery files. Retrying deletion at operation.lock can erase a successor generation.
- Release must serialize with the existing recovery auditor, verify ownership before atomically detaching the whole generation, validate the detached store path, then retry only that immutable released path.
- Real filesystem evidence must prove action completion survives one declared transient cleanup failure, successor owner/files remain intact, and a live auditor claim is not deleted underneath its inspection. The transient I/O fault is injected at the filesystem cleanup boundary; all lock directories, rename, owner identities and successor store acquisition are real. No deployment or running store is touched.

Before changing rename handling, the local candidate build for `4781f65` failed
with `EPERM` renaming its owned `operation.lock` to the released generation.
Failure boundaries: transient Windows sharing errors must not discard a completed
action; permanent errors must remain failures after a bounded retry; unrelated
errors must propagate immediately; ownership must be checked before each attempt
under the existing auditor claim, and detached cleanup must never touch a successor.
Exercise the real store in private filesystem roots, injecting only the rename
error at the filesystem boundary and retaining actual owner and attempt ledgers.
