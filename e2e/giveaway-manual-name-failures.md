# Join giveaway by a typed host name: failure inventory

Written before the change (2026-10-14). Reported live: a player hosting ~16 items per
round on EU IV could not be joined. The dialog's merchant-name picker only offers
`giveawayPlayers[realm]`, built from players our own characters see on that realm and
ALData merchants seen in the last 2 minutes, so a host who is not a listed stand
merchant on a realm without our characters is unreachable. The coordinator's
`/merchant/join-giveaway` already accepts any name (1-40 characters) and the merchant
looks for the seller at the market. Live journey: `e2e/live-giveaway-manual-name.spec.ts`.

1. **Unlisted host.** A typed name that is not loaded cannot be chosen, so Join has no
   seller.
2. **Name altered.** The queued search uses a trimmed, case-preserved copy of exactly
   what was typed, not a near list match.
3. **Listed names lost.** Loaded players must still be offered and selectable.
4. **Empty or oversized input.** Blank input offers nothing; the coordinator still
   rejects names over 40 characters.
