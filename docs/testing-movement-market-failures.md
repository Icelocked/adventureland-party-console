# Movement and marketplace failure regressions

Failure modes recorded before implementation for issues #29 and #26:

- A planner rejection becomes HTTP 503 and is mistaken for a transport outage,
  preventing native fallback and indefinitely preserving the route retry budget.
- Planner failures without a route-related word (including native-only mode and
  worker startup failures) skip fallback even when returned as normal responses.
- Actual network, timeout, or HTTP availability failures incorrectly start native
  movement instead of preserving the communication hold and request metadata.
- Native fallback failure is reported as a temporary pause, or its original
  planner rejection is lost from terminal diagnostics.
- A command-level catch logs an already reported movement hold as a second,
  misleading generic command failure.
- Successful plans, response identity checks, cancellation ownership, and native
  search bounds regress while changing the error response.
- An ALData sell command disappears after first delivery, so a replacement worker
  on the destination realm cannot receive the same job and command identity.
- Retention reintroduces completed commands or changes one-shot command delivery.

Extend the retained movement-service and heartbeat-composition exceptions before
changing production code. Exercise the real movement HTTP handler with the
movement service, including a planner rejection and a genuine HTTP failure;
retain existing return-planner checks for parallel candidate failures. The
heartbeat boundary must redeliver the same sale job across successive runtime
reports until completion removes it. These are protocol checks, not proof of
native travel or an actual cross-realm sale. The disposable native E2E server
has one realm and cannot establish a cross-realm marketplace transaction.

Run existing console/native E2Es when the environment supports them, preserve
their reports, and report any setup blockers separately from regression results.
