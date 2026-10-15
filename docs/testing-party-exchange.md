# Party exchange collection

`npm test -- -- --project=live --grep "party (Auto exchange|Exchange) hands selected native stock"`

Both inventory actions authorize merchant work. The party member only performs a
normal kept-item handoff; it never executes an exchange or visits an exchange NPC.
Auto merchant remains an exclusive final destination, so selecting it replaces
Auto exchange rather than implicitly exchanging the collected stock.

Failure modes covered by the native journeys: missing party menu actions, absent
Auto exchange labels, automatic routine disabled but stock collected, automatic
compound disabled accidentally preventing exchange collection, locked or unrelated
stock taken, manual exchange dispatched before its selected pickup, and restart
losing the durable pickup dependency. The manual job stays blocked until its own
confirmed kept-item receipt arrives; arbitrary carried merchant stock cannot
satisfy the dependency.

Inspect `party-exchange-native` and `party-exchange-dashboard` attachments under
`.build/e2e-results/` and `.build/e2e-report/`. Evidence includes initial durable
work, final native inventories, merchant-owned exchange reward checkpoints and
native socket events for both characters. Run `npm run test:e2e:verify` afterward.

Building creates a candidate only. Activation of these coordinator/dashboard
changes uses the supported CoordinatorOnly restart only when explicitly requested.
