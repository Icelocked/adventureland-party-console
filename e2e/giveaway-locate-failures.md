# Giveaway entry: locating the host, bank, and expiry: failure inventory

Written before the change (2026-10-14). Upstream #129 reports `Giveaway entry failed
— <character> was not visible at the market` and "also cannot join giveaways in
bank". Live on 2026-10-14 the coordinator queued 18 giveaways from buffett (EU IV)
at 23:07:12 from ALData marketplace data, then deleted them without a log line while
the merchant ran higher-priority work: marketplace-sourced jobs expired two minutes
after the merchant was last seen, whatever the giveaway's remaining minutes. Each
also held a 30-minute claim, so a later scan could not queue it again.

Server facts (pinned `adventureland_mongodb`): `join_giveaway` refuses with
`cant_in_bank` when either the joiner or the host is inside the bank, and with
`distance` unless both share a map within range. A slot's `giveaway` is its
remaining minutes, counted down once a minute; at zero with no entrants it restarts
at 5. `/api/pull_merchants` lists every online merchant with an open stand (name,
map, x, y, server) from the character's last database sync.

Live journeys: `e2e/live-giveaway-locate.spec.ts`. The directory lists only merchant-class stands
and an account can have only one merchant online, so the directory journey declares the
priest host's entry (from its live server position) in the real directory response.

1. **Host away from the market.** A manual join by name, with the host's stand out
   of sight of the merchant's market spot, must find the stand through the game's
   merchant directory, walk there and join. Not waiting at the market and failing.
2. **Merchant starts in the bank.** A join dispatched while the merchant is inside
   the bank must leave the bank before `join_giveaway` (no `cant_in_bank`).
3. **Host in the bank.** A host whose directory location is a bank map is reported
   as such (it cannot be joined there), not walked into; automatic discovery does
   not queue it or spend its claim.
4. **Wrong realm or no stand.** A host listed on another realm, or not listed at
   all, fails with that reason after the market fallback, not a silent wait.
5. **Joined, observably.** Success means the host's trade slot lists the merchant
   on the server, not just a success message.
6. **Expiry from the real duration.** A discovered giveaway's job expires at the
   observation time plus its remaining minutes, not two minutes after the observation.
7. **Silent expiry.** A giveaway job deleted unattempted because it expired logs a
   warning naming the host and item.
8. **Claim kept after expiry.** An expired job releases its claim, so the next
   observation of a still-running giveaway (restarted at 5 minutes) queues it again.
9. **Duplicate queueing.** Releasing the claim must not queue a second copy while a
   job for the same host and slot is still queued or running.
