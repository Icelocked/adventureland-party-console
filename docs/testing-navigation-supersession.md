# Superseded convoy and Town ownership (#77)

Failure inventory recorded before implementation:

- Realm departure can preserve a convoy whose route server is no longer reachable,
  leaving navigation and merchant collection permanently held.
- Independent farming controllers can retain their own departed convoys.
- Clearing commands without advancing navigation revisions permits retained work
  to reappear after the switch.
- A Town command can remain deliverable after its captured revision is superseded;
  its pending membership then blocks ordinary farming and patrol admission.
- Retiring a stale command must preserve a newer Town cycle or another command.
- Stale Town membership can survive restart unless retirement is persisted.
- An already-running native Town can receive a genuine supersession 409 after
  its request is admitted. It must release local movement ownership quietly.
- Network failures, other HTTP failures, and unrelated 409 responses must remain
  visible failures rather than being treated as navigation supersession.

`live-navigation-supersession.spec.ts` observes actual native convoy travel,
realm departure and destination login. Its Town scenario holds an actual native
progress request, clears party focus through the maintained API under the
same controller to advance navigation without replacing Town, releases the request to
the real coordinator's 409, and checks pending membership, local navigation,
native log output and persistence across coordinator restart. Browser interception
changes request timing only; it does not fabricate a progress response.

Run `npm test -- -- --project=live e2e/live-navigation-supersession.spec.ts`, retain
the report/results and run `npm run test:e2e:verify`. No production console
activation is authorized by this validation.
