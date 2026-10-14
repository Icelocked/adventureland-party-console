# Withdrawn manual upgrade identities

Failure inventory before implementation: bank-created marks have only passId
while ordinary manual production requires requestId; one such mark blocks a
mixed batch and queues an empty retry indefinitely. Restart normalization can
change legacy identity while an admitted command retains the previous identity.
Identity compatibility must never authorize a different item or target, turn a
manual mark automatic, remove offering requirements, or reset intermediate levels.

Read-only live evidence confirmed two sshield +0 marks, target +4: a bank-created
passId-only mark in slot 7 and an ordinary requestId mark in slot 9. No production
roll occurred in the logged failure window.

`live-manual-upgrade.spec.ts` exercises the native bank withdrawal and mixed
manual batch, preserves request/mark/native production evidence, and checks
completion without the continuation rejection loop.

The native RED reproduced the exact three continuation error messages from
`/merchant/production`; retained at `.build/bank-manual-upgrade-red-report/`
and `.build/bank-manual-upgrade-red-results/`. The retained legacy normalization
regression was written first and failed before implementation.

The corrected native journey passed in 56.2 seconds: eight native successful
rolls, both shields at +4, no remaining upgrade marks, and no replayed marks after
coordinator restart. `.build/bank-manual-upgrade-green-report/` and
`.build/bank-manual-upgrade-green-results/` preserve the result, also available
at the normal E2E paths. The artifact verifier passed all 46 evidence files.

Typechecking passed. The focused recovery suite passed all 12 cases, including
legacy identity compatibility and refusal of changed identity, item or target.
The broader suite passed 51 of 52; the existing `upgrade intent retains starting
item and distinguishes equipped slots` assertion expects manual marks without
request IDs and also fails against active pre-change artifact `60ca5c07…`.
Both logs are retained at `.build/bank-manual-upgrade-regressions.txt` and
`.build/bank-manual-upgrade-baseline.txt`. No live activation was performed.

Combined-branch review (2026-10-14): the retained intent assertion now checks
distinct durable request IDs, original item/slot/target preservation and the
remaining equipped request's identity after removing the inventory request.
The offering integration must exempt explicit manual upgrades without dropping
automatic compound conflict protection. A regression reproduced that dropped
guard before restoring it; rejected compounds leave no production receipt.
All 111 focused merchant/storage/production/Steam regressions passed in
`.build/pending-work-focused-unit.log`. These results supersede the stale
no-request-ID assertion above; they do not claim a full-suite run.

The combined checkout also passed nine focused console scenarios and all three
selected native scenarios (remote offering/input delivery, selected UHills healer
recovery, and the mixed manual shield batch). Preserved reports/results are
`.build/pending-work-console-{report,results}` and
`.build/pending-work-native-{report,results}`. The broad local unit attempt was
incomplete: missing pinned game fixtures were restored, the stale ID assertion
was corrected, and lingering dashboard-query/priest processes were stopped.
The focused results above are the current local evidence; full CI for this
combined commit is a separate validation run.
