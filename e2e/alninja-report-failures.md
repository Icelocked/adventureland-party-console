# ALNinja trade reporting: failure inventory

Written before the change (2026-10-17). Requested: the party reports the trades its characters
see and make to an ALNinja instance (`POST /api/v1/observations`, see the instance's `/#/api`),
using the instance's admin `REPORT_TOKEN`. Live journey: `e2e/live-alninja-report.spec.ts`, against
a local stand-in for the ALNinja endpoint.

1. **No setting.** The console has nowhere to enter an ALNinja URL and report token, and reporting
   can't be turned on or off. The token must never be returned by the API or shown again.
2. **Witnessed trades missing.** A stand trade a character sees (the game's `"+$$"` ui event: seller,
   buyer, slot, item with price and quantity; `snum` when a buy order was filled) is not reported.
3. **Own trades missing.** New entries in a character's trade history (`trade_history`) are not
   reported; the first read is the starting point, not new trades; a repeated trade the game merges
   into the last entry reports only the extra units.
4. **No coverage.** Reports must keep arriving while nothing trades, at most a minute apart, listing
   the open stands in view (`inView`), or ALNinja's watch windows (joined when under 2 minutes apart)
   break up.
5. **Slow reports.** A witnessed trade waits for the next periodic report instead of being sent
   within a few seconds.
6. **Lost on failure.** A report the instance rejects or can't receive is dropped instead of retried.
7. **Duplicated across reloads.** Reloading the character code installs a second listener, so each
   trade is reported twice.
8. **Reports while off.** Nothing is sent, and the token is not used, while reporting is disabled.
9. **Wrong shape.** Each report must pass ALNinja's validation: `reporter`, `sentAt`, `region`,
   `server`, `map`, `inView` (≤ 500), `sales` (≤ 500), `history` (≤ 100), with
   `Authorization: Bearer <REPORT_TOKEN>`.
10. **NPC stands in view.** Found in the first passing-shape run: `parent.entities` also holds NPC
    merchants with stands ("Tricksy", "Fvona", "Gn. Spence"). ALNinja accepts only character names
    (`/^[A-Za-z0-9_]{1,40}$/`), so "Gn. Spence" would get every report rejected. `inView` lists
    player characters only.

Added 2026-10-18 for regular users, who have no admin token: ALNinja registers a reporting key that a
character mails to its key-mail character (subject `alninja_auth`, the key as the message), and
accepts `Authorization: Bearer <Character>:<key>` with at most 12 reports a minute per key.

11. **No key.** The console can't generate a reporting key, or the key appears in the public state.
12. **Reports before confirmation.** Reports are sent (and rejected) with a key ALNinja hasn't
    registered yet.
13. **No mail.** There is no way to have the merchant mail the key to ALNinja's key-mail character,
    which must come from ALNinja's `/api/v1/auth`, not be hard-coded.
14. **Wrong owner.** Once ALNinja confirms the key for the merchant, every character must report
    with `<merchant>:<key>`.
15. **Over the key's limit.** More than 12 reports a minute from all characters together are
    rejected by ALNinja; the console must hold reports back and let characters merge them.

Not exercised by the journeys: item 7 (a code reload replacing the reporter) and item 15 (three
characters report about three times a minute, well under the limit). The journey checks
that each trade is reported once per character, but does not reload the character code.

Added 2026-10-19: two Rings of Courage +2 that FonzeMerch bought through an ALData marketplace
itinerary never reached ALNinja, while its other trades that hour did. The itinerary buys, then
asks for the home realm at once, and the coordinator restarts the merchant 150 ms later.

16. **Lost to a reload.** The `"+$$"` a character saw waits 2 s for its report; a reload or realm
    hop sooner discards it. Expected: a trade seen just before the character's code reloads is
    reported after it starts again.
17. **History reset by a reload.** After a reload the first trade-history read is the starting
    point, so purchases made just before the reload count as old. Expected: the character's last
    read survives a reload for a few minutes, and the trades added since are reported, once.
18. **Reported from the wrong realm.** A trade seen on one realm and reported after moving to
    another must keep the realm and map where it happened, without claiming the old realm's
    stands are in view.

The journey reloads the fighter's client right after its purchases on the same realm, so it checks
16 and 17 and that the realm and map are the original ones, but not a report sent from a second realm.
