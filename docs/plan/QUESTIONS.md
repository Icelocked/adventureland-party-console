# Open questions

A few questions about the current console that only its author can answer. A
yes, no or "here's why" is plenty. The context for each, with file and line
on b9b5c91e, is in [QUESTIONS-DETAILS.md](QUESTIONS-DETAILS.md) under the same
number. The section after the questions lists what the fork will change in
The current console's behaviour, so you can object to any of it.

## 1. Is a caller planned for `pause()`?

Movement has a `pause()` for combat during a walk, and no combat mover calls it.

**Your answer:**

## 2. Is a caster planned for Agitate?

Agitate sits in three skill gates, and nothing casts it.

**Your answer:**

## 3. Was `mp_cost` meant in the priest MP checks?

Three priest checks read `G.skills.heal.mp`, which game data does not have.

**Your answer:**

## 4. Do the unused Hunt cycle records have a writer in unpushed work?

Temporary encounters, `exitMode`, stage `failed-return` and the `resume` branch of `begin` have no production writer or caller on b9b5c91e.

**Your answer:**

## 5. How long does v1.4.0 stay a rollback target?

19 scoped fields are saved twice only so a rollback to v1.4.0 can read them.

**Your answer:**

## Decided on our side

The fork will change these behaviours of the current console.

Tasks and travel

- One fixed order decides which task gets the party, and Hunt and Achievement Hunt are on and off toggles that cannot both be on.
- Only whatever started a walk, an escape or death recovery can stop that walk.
- Asking for the same destination again keeps the current walk, and the walk's owner fixes a party that is not moving.
- A walk past its deadline stops, and whatever asked for it decides what happens next.
- On a walk, fighters fight as the defender and passive monster settings say, keep heading for the destination, and resume the walk after the fight.
- Steps and routes keep the whole following party out of idle monsters' aggro where the area allows, boss approaches included.
- After an escape or a death the party regroups in Main near the spawn point.
- Home is where the game puts a character, the Main spawn point after a respawn and the Town landing point after Town, and every feature checks those same points.
- A travel command during an escape or death recovery ends it, and the console carries on from wherever the party is.
- A group walk keeps going through a late member report while no attacker is known, for up to two report intervals.
- A group walk starts from where the leader stands, and a drifting leader no longer restarts Hunt travel.
- Stuck walks, Hunt travel and realm switch stragglers keep trying while they make progress. When progress stops, the console changes strategy and keeps going, and the card shows what it is trying.

Events

- A manual move or a bestiary pick drops a character from an event only when it leaves the event map, and a rejoin button undoes it.
- Event walks start when the route time says, Hunt keeps farming until then, and the party arrives no more than 60 s after the spawn.
- Short-window bosses take over a trip in progress at once, and other events wait for the trip to arrive or fail.
- Walks follow every boss that moves.
- An event walk waits for the priest only while the party can still arrive within 60 s of the spawn.
- A refused join skips that round on no such event or too late, and retries with growing waits on sick or in the bank.
- Witch's Cipher keeps 1 clue as the default, and a setting lets the merchant start a cipher nobody has submitted.
- Solo characters and the party never wait on each other's event trips.

Rares

- One list says what a rare may interrupt: farming and Hunt travel, with a per-rare switch for Hunt travel. Trips started by hand finish first.
- A failed walk to a rare keeps trying while the party gets closer, and stops when the rare is gone.
- A farming mode change during a rare applies at once, after a warning that it ends the fight and its loot.
- Scatter comes back as soon as the rare is done.

Combat and survival

- The priest heals first when anyone is under a per-character setting, default 80% HP.
- The priest keeps basic attacking while its MP covers the heals the party needs, from heal costs in game data.
- Every fighter drinks HP potions below a per-character setting, default 50%, and skips a potion that would heal more than is missing.
- Regen waits while any fighter keeps dropping below 80% HP, so the potion cooldown stays free.
- An escaping character drinks HP first, with the same potion setting.
- Regen runs only when no monster targets the party and the missing HP is less than a potion restores.
- After a death the console judges the general trend of monster HP against survivor HP, ignores a short burst of bad luck, and recalculates at once when the fight changes.
- Stomp, Dash, Energize, Curse and Party Heal share the skill engine's MP reserve.
- The set tank uses Taunt and Absorb Sins, or the leader when no tank is set, and only a warrior or a priest can hold that role.
- Reflect handling becomes a per-character setting for magic and physical reflect, with today's monster list as the default.

Cave of Many Dreams

- After a visit, escape and death recovery work outside the Cave, and the party resumes once everyone is out and walking. Release still ends the wait sooner.
- A member drops from the visit when the game reports it offline. A member that stops making progress makes the console change strategy to bring it out.
- With event protection off, the party leaves between encounters while it can still reach the event within 60 s of the spawn.
- Cave travel repairs keep going with growing waits, and the card names the failing member.

Merchant

- The merchant keeps the gold its queued jobs, stand buy orders and the player's minimum need, and one reserve, default 0, covers every automatic purchase. Short gold pauses a buy order or holds a job.
- The merchant puts its normal gear back on when a job interrupts gathering, and a full bag while gathering queues a bank trip.
- Automatic work never enters PVP or blacklisted realms, and the merchant finishes all jobs on one realm before one trip home.
- Escape, potion and heal calls keep the share of the call limit they need, and background lookups wait when the limit gets close.
- The merchant refreshes Merchant's Luck on the party's fighters before it runs out.
- Giveaways the merchant found itself expire at their end time.
- Stand slots follow the game's count, so a level 70 or 80 merchant uses 24 or 30.
- When a buy order's slot empties without a receipt, the merchant counts what it received and places a new order for the rest.
- The merchant takes mail postage from the bank first, and fails clearly when the bank is short.
- Shutdown waits while a trade is in progress.

Settings

- A save or an import with one bad field changes nothing and names the field.
- Every settings change writes a log line with the old value, the new value and its source.
- Controls show loading and stay locked until settings arrive.

Dashboard

- Each part writes its own activity line, the card shows the most important one first, and a Hunt pause reason that needs a click goes on top.
- Each member's card shows its own group walk progress, and the Hunt line refreshes every second.
- The 250 ms backup refresh sends only the fields the clients read.
- Characters send debug data only while a diagnostics view is open.
- The header shows Live or Reconnecting from one connection state per character.
- The dashboard reads rule answers from the console, such as free stand slots and Cave entry, instead of keeping its own copies.
- The console refuses routing a follower to a monster and marking the merchant as a follower.
- The merchant card shows the gathering the console actually plans, and each character's NPC sale rules with the owner's name.
- The Hunt setup priority boxes go, and priorities are set in the focus picker.
- The WTB dialog opens with the listing's price filled in.
- The gold total includes offline characters' gold, marked as such.
- A Tracktrix total the console adds up itself is marked as calculated.
- Both elixir timers run from one clock.
- Game logs stay in memory only, and the panel says so.
- The kill total is a lifetime count, and kills, DPS and loot all use the browser's midnight.
- A console restart removes every old game handler.
