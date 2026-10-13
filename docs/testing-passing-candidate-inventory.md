# Passing candidate selection failure inventory (before helper change)

Run38340656629 shard11, artifact11789526829: outbound passing kill succeeds. Returning native Goo501 is actually killed while the priest moves in the exact expected convoy/epoch. Priest issue at1791864172491, own native hit at1791864174437 (1946ms), damage7901/killtrue, death1791864174440; actual issue records travelling/movingtrue and candidate501.

The same retained receive stream contains an earlier actual Goo40 kill (issue1791864165943, hit1791864166940,997ms), but its issue is stationary and no matching moving cohort issuance qualifies. The current helper selects only the first eligible own hit40, returns false at its cohort check, and reselects40 on every poll. Later valid501 is never examined.

Before editing, a read-only artifact replay confirms first eligible40 has no qualifying motion proof while later501 passes every existing native victim/actor/sequence/time/convoy/epoch/phase/map/instance/realm/candidate predicate and has actual native death. This is observer candidate starvation, not a gameplay or admission failure.

Failure boundaries retained: never borrow a different victim or projectile, another peer receipt timestamp to order this actor, a stale attack after a later farming attack, a different convoy/epoch, a stationary-only encounter, or a delay over2000ms. The45s real native kill budget and actual server absence check remain unchanged. Only iterate already-observed eligible candidate hits until one satisfies the entire existing proof.
