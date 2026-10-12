# Conditional BankBoi staging reservation (#100)

Failure inventory recorded before implementation: ordinary sorting, deposits,
partial-stack homes or merges can silently exclude seven usable cells; the UI
can disagree with native capacity; stale queued cargo can capture normal stock;
enabling an offline first worker can fail to adopt occupied transfer cells;
sorting can move adopted cargo; disabling the last worker can leave stale cargo
or an old sort signature. Missing heartbeat fields must preserve compatibility.

The native journey in `live-bank-staging.spec.ts` fills both initial panes past
the old 77-cell boundary, verifies native sorting and dashboard reservation,
then enables a saved offline BankBoi and verifies cargo adoption and preserved
transfer cells, and removes the last worker to verify release and cargo cleanup.
Retained storage regressions cover ownership and protection.

The pre-change native reproduction is preserved in
`.build/bank-staging-red-report/` and `.build/bank-staging-red-results/`: slot 35
remained empty after sorting. Its 44 evidence files passed integrity checking;
the verifier correctly rejected the failed suite. The first post-change run
confirmed the Short Sword moved from slot 40 to slot 35, but an incorrect test
expectation assumed cross-pane sorting and expected a Helmet. This diagnostic
run is in `.build/bank-staging-expectation-report/` and
`.build/bank-staging-expectation-results/`; the assertion now follows the actual
per-pane ordering. Its native BankBoi stack/restart regression passed.

Typechecking passed. The retained bank/cargo/stack suite passed 82 cases,
BankBoi scheduler/receipt/routes passed 28, and deposit/crafting consumers passed
54. Logs are `.build/bank-staging-retained.txt`,
`.build/bank-staging-storage-regressions.txt`, and
`.build/bank-staging-consumers.txt`.

The three native automatic bank-collection scenarios passed in
`.build/bank-staging-dialog-report/` and `.build/bank-staging-dialog-results/`.
That run's transition test proved native cargo adoption but clicked a
server-rendered Bank control before browser event handlers attached. The browser
journey now waits for the actual dialog to open before checking reservation
labels, preventing an absent dialog from falsely satisfying a zero-count check.

The corrected full native/browser transition passed in 1.2 minutes; final
evidence is in `.build/bank-staging-green-report/` and
`.build/bank-staging-green-results/`, also retained at the normal E2E paths.
`node e2e/verify-artifacts.cjs` verified all 47 evidence files with passed status.
Both dashboard screenshots were inspected: the full pane has no reservation
banners, and the saved offline worker reserves exactly pane 1's final row.
The final phase verifies removing the last worker clears row cargo and restores
the ordinary pane. No live console activation or restart was performed.
