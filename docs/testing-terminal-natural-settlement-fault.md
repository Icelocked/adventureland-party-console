# A real terminal settlement can precede the fault fixture

Failure inventory BEFORE fixture amendment: native full run 38525662222 shard 10,
artifact 11877907712. Ordinary Pumpkin variant passed in 4.8 minutes. Fault variant failed
prearming, not terminal settlement. W actual leave ACK at 1791963096273, actual Main endpoint
sample at 1791963096296, genuine journey 7 terminalSettlement success and convoy-complete
at 1791963096837. No final completed=true barrier POST existed. The fixture aborted that
real convoy-complete before peer release, never armed response loss (forwarded observations: 0),
then ownership correctly reprepared epoch+1. The required held barrier POST was
impossible after already successful genuine settlement. No runtime guard defect
is established by this failure.

Preserve the original held-barrier/control-response-loss branch exactly. Add a
separately identified natural-terminal-before-convoy-response-loss branch: hold
an actual matching W convoy-complete request unforwarded, verify exact captured
journey/owner/generation/version/geometry/native ACK and stopped living endpoint,
plus fresh current coordinator ownership and no prior W completion. Observe
actual P completion barrier release or its separately certified independent
settlement BEFORE forwarding W completion, so ordinary completion cannot mask
that proof. Only then fetch a genuine still-live held completion request once,
maxRetries: 0; require actual successful HTTP response and discard its delivery.
Retain both observed boundaries and never claim the naturally missing barrier
POST was an injected transport loss. An expired request cannot count as deliberate
response loss. Later genuine native retries can finish the saved return.

Negative boundaries: wrong/superseded owner/runtime/route/geometry/goal, native
nonarrival/moving/dead/paused, failed or absent ACK, retired/expired request,
prior coordinator W completed and non-2xx response must not certify this branch.
No new game packets, synthetic receipts/status, native mutations, route/endpoint
or timeout changes. Existing failed native case is the before-code reproduction;
root runs that exact case locally and both Pumpkin variants serially before CI.

The original branch requires a held barrier POST specifically; held convoy-complete
requests cannot satisfy its arming guard. Fetch failures remain proof failures.
Cleanup aborts a still-live failed request without counting response loss.

The forced native run exposed another distinction: a peer's released movement
barrier can precede final convoy completion readiness. HTTP 200 with
`waiting:true` is the real protocol's retry instruction, not an accepted
completion and not a transport failure. Forward it unchanged, record it, and
let the actual client retry. Only a later `ok:true`, non-waiting, non-superseded
response may increment the deliberately lost completion count. Retain complete
response bodies for rejected responses instead of an empty error description.

Peer review identified two additional false-proof boundaries before amending
the guards: HTTP 200 can carry `ok:false` or `superseded:true`, and defensive
movement can start while the native snapshot awaits the coordinator read.
Require an actual accepted, non-superseded completion response and a fresh
coordinator observation still stopped at that same finite terminal endpoint.

## Force the natural branch locally

Failure inventory BEFORE this fixture amendment: both local Pumpkin variants
passed, but the fault case used the original held-barrier/control-response-loss
branch. That does not cover the new natural-settlement branch. A local opt-in
must not fabricate a terminal receipt, forward a held completion early, count an
expired request, or silently accept the original branch.

Set `E2E_TERMINAL_FAULT_NATURAL=1` when running the existing lost-final-completion
Pumpkin case. The helper still tries the verified natural-settlement path, but
withholds original control-response-loss arming. Actual held barrier requests
and their existing native HTTP timeout remain unchanged. The real executor must
settle its acknowledged endpoint and emit a real convoy-complete request before
the natural path can arm. The proof must explicitly identify that path and lose
one accepted, non-superseded completion response after the genuine peer proof.
The flag is retained in proof and final artifacts. Default mode preserves both
branches. No scenarios, game state, production behavior or deadlines change.

PowerShell example (use the repository's configured native test environment):

```powershell
$env:E2E_TERMINAL_FAULT_NATURAL='1'
npm test -- --grep 'lost final native completion response'
Remove-Item Env:E2E_TERMINAL_FAULT_NATURAL
```

### Forced-mode control-loss prologue

Failure inventory BEFORE this amendment: holding the completion barrier alone
keeps the control lease fresh. The real terminal-settlement path requires an
expired or missing matching control signal, so a barrier timeout can instead
enter communication hold and change the epoch before the forced branch arms.

In forced local mode, first apply the EXISTING actual aligned-barrier guard:
matching owned current journey, held completion barrier, successful native leave
ACK, sole final step, and a living stopped actor at the exact endpoint. Only then
start a declared control-response-loss prologue. Real status observations still
reach the coordinator; their genuine responses are discarded. This prologue
does not set faultArmedAt or qualify the original branch. Continue observing until
a real terminal receipt and actual held convoy-complete request satisfy the
natural branch. Peer proof and an accepted owned completion response whose
delivery is discarded remain mandatory. Artifacts separately retain the prologue
timestamp. This deliberately induced prologue is not evidence that a naturally
missing barrier POST was itself an injected loss. No production change, new
test, native execution or deadline change accompanies this amendment.

Local validation: ordinary Pumpkin, original held-barrier response loss, and both manual event-exit cases passed together (four cases, 173 verified evidence files). The forced natural branch then passed in 3.3 minutes: seven accepted native status observations, one genuine waiting response forwarded unchanged, exactly one accepted completion response discarded after real peer release, and no completion-proof errors. The final guard requires the fresh coordinator observation to remain stopped at the matching endpoint. Both paths retain exactly one native leave and one actual leave acknowledgement.
