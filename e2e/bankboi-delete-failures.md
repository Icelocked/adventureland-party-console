# Deleting a BankBoi that is already gone from the game: failure inventory

Written before the change. The user deleted the BankBoi FonzeMerch0 in game. The
coordinator still listed it, and the dashboard's Delete returned
`{"error":"no_character"}` every time: the route asks the game to delete the
character, treats any refusal as failure, and only forgets the BankBoi after the
roster stops listing it. A BankBoi that no longer exists could never be removed,
and the merchant kept treating it as storage.

1. **Still stuck.** When the account roster no longer has the character, Delete
   must forget the BankBoi and succeed without asking the game to delete it.
2. **Forgetting a live character.** A character the refreshed roster still lists
   must go through today's checks (assets, cooldown, pending work) and the game's
   deletion, unchanged.
3. **Stale roster.** The decision uses a freshly refreshed roster; if the refresh
   fails, nothing is forgotten.
4. **Other refusals.** Any game refusal other than the character being gone still
   fails and keeps the entry.
5. **Guards before network.** A BankBoi the cached roster still lists must be refused
   by the asset, pending-work and cooldown guards without any request or roster
   refresh. Only a BankBoi missing from the cached roster, or a game reply of
   `no_character`, triggers the confirming refresh.
