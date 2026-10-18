# Manual upgrades of identical copies: failure inventory

Written 2026-10-18. Live: FonzeMerch had six manual broom upgrade requests (+4 to +5, one +3 to +5)
anchored to slots 23, 16, 21, 22, 24 and 17; the lucky-slot inventory tidy
(`runtime/characters/lucky-upgrade.ts` `tidy`, run before jobs and while idle) had packed the brooms
into slots 14–18 without updating the requests. Every manual
upgrade job failed within a second with `Upgrade inventory recovery ambiguous: broom +4 to +5;
original slot 23; unfinished candidates 14 (+4), 15 (+4), 16 (+4), 17 (+4), 18 (+4)` (43 times in
13 minutes), and the merchant card showed "No queued work". Journey:
`e2e/live-manual-upgrade-duplicates.spec.ts`.

1. **Ambiguous halt.** Identical unfinished copies, each with its own request, move out of their
   requested slots. A request whose slot no longer holds its item finds several identical copies and
   stops the whole job as ambiguous, although any of them satisfies it.
2. **Stolen copy.** A displaced request must not take a copy still in another request's slot: that
   request would see its item already upgraded and count as done while a displaced copy stays
   unupgraded.
3. **Double or missed upgrade.** Each copy is upgraded exactly once: none twice, none left at the
   starting level.
4. **Real ambiguity kept.** Copies that differ (another level, or other properties) are not
   interchangeable; a displaced request among them still stops as ambiguous. Unchanged code path,
   not exercised by the journey.
