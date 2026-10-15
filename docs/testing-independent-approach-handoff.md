# Independent approach completion hands ownership to normal combat

Failure inventory BEFORE amendment: private live-warrior-movement-errors.json
contains a bounded201-log Warrior history with96 identical intentional approach
cancellations mislabeled Movement failed/route-failed. Parent's longer watcher
counts394 approaches in520seconds during the Ice Golem fight, typically direct
3.9px and cancelled after37ms. Native attacks continued (392 accepted of434).
Observed logging is not proof those routes were blocked or attack failed.

Source cause: actual-ready+committed waitReady clears all approach memory. Normal
class combat can then leave range; next tick creates a fresh full-radius pull
approach for the same already-engaged target, instead of yielding ordinary combat.
Latch only own actual-ready+committed context key. Same-key subsequent ticks yield
normal class movement/attacks; temporary same-key defensive/maintenance blocking
must not erase completion. New target/selection/runtime/navigation key, explicit
stop or absent context retires the latch. Do not latch another actor's hit or
commit before this actor reaches actual range. Preserve precommit ready-loss
routing/halving, actual target motion, safety and native confirmation gates.

Intentional owned approach cancellation must carry cancellation provenance and
Movement cancelled phase rather than falsely report route-failed. It must neither
report success nor touch a superseding foreign journey. Before-code behavioral
regressions cover own committed arrival then repeated lost-range ticks, temporary
defense, new identity, explicit stop, actual-source port cancellation ownership
and movement diagnostic classification. Existing native acceptance is unchanged;
root serial native tests are already running and no new process is started here.
