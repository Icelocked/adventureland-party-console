# 10. Inventory, bank and commerce

Checked against Ryan's base `refs/review/ryan-1.5` (b9b5c91e) in (local checkout). Every file:line is on that ref unless it says "fork HEAD" (af92de45). The fork's live tip 21b8362d changes no file in this part (`git diff --stat af92de45 21b8362d` in pm-worktrees/pta-pull touches only characters/shared.js lines 71 and 18438-18926).

This spec maps everything the console does with items: item identity and the item catalog,
inventory marks and automatic marks, the bank and bank queues, BankBoi storage, stocking, upgrades,
compounds, stat scrolls and the production journal, exchange, the lucky slot, deconstruction,
markets (ALData marketplace, player stands, native WTB offers, bids, manual orders), Ponty, mail,
and the fork's Ponty and Ron watch.

The job queue that runs these as merchant jobs is in [08](08-merchant-jobs.md). The realm hops
the market jobs make, the merchant's hands and the game call budget are in
[09](09-merchant-realm-and-gear.md).

Counts: 111 behaviours and 1445 functions in `catalog/10-inventory-bank-commerce.json` (counted with `node -e` over that file); 16 handoffs in `catalog/handoffs-10.json`.

How this map was made: four readers went through every function in this part on the Ryan ref (shared.js by its Ryan line ranges, every other file start to end) and checked the full review (local checkout) and the first pass `review/merchant.md` claim by claim. Section 7 lists each review claim with its verdict. Line numbers in the full review are mostly fork HEAD lines; this spec gives Ryan lines.

## 1. What it does today

### Markets

**INV-001 Share one ALData request budget.** Every ALData call (market feeds, Ponty, publishing, location refresh) waits for a slot in one rolling limit so the console stays under ALData's rate limit.

Rules:

- allows at most 12 requests per rolling 60 s window; a caller waits max(250 ms, time until the oldest request leaves the window) (commerce/aldata-client.ts:8-9, 18-28)
- each request times out after 20 s (aldata-client.ts:10, 35)
- HTTP 429 throws 'ALData rate limit reached'; any other non-ok status throws 'ALData returned HTTP <code>'; 204 or an empty body returns null (aldata-client.ts:37-41)
- the base URL is AL_DATA_URL or https://aldata.earthiverse.ca (application.ts:1356, commerce/market-feeds.ts:36)

Settings:

- env AL_DATA_URL, default https://aldata.earthiverse.ca (application.ts:1356)

**INV-002 Refresh the ALData market snapshot.** The console pulls every player stand from ALData every 10 s and the published trades every 5 minutes, keeps the last good lists, and re-runs bid matching after each pull.

Rules:

- start() refreshes everything once, then merchants every 10 000 ms and trades every 300 000 ms (commerce/market-feeds.ts:71-76)
- a refresh already running returns the current snapshot instead of starting another (commerce/aldata-service.ts:85)
- a merchants snapshot with buy orders but no sales counts as partial and is fetched once more (aldata-service.ts:63-67)
- an empty sales or buy list keeps the previous list (aldata-service.ts:69-72)
- after merchants: record price history from the sales, then queue ALData bid matches (aldata-service.ts:74-75)
- after trades: record the highest public WTB per item (aldata-service.ts:81)
- a failed refresh stores the error text in aldata.error; success clears it and persists settings (aldata-service.ts:90-94)
- on restart the saved listings, buy orders, trades and timestamps come back; key, auth (default 'NO') and publishedAt come from the saved authentication (commerce/initial-aldata.ts:18-35)

Settings:

- aldataTrades, aldataMarketListings, aldataMarketBuyOrders, aldataMerchantsUpdatedAt, aldataTradesUpdatedAt in saved settings (initial-aldata.ts:24-28)
- ALData key, auth, authCheckedAt, publishedAt in saved authentication (initial-aldata.ts:20-30)

Handed over by other specs: 3 functions (13-lifecycle).

**INV-003 Normalize ALData stand listings.** Raw ALData merchants become one listing per stand slot, split into sales and buy orders, sorted best price first, each with a stable key.

Rules:

- a slot counts as a buy order when item.b is set, else a sale; it needs a name and a price of at least 1 (commerce/market-normalization.ts:50-57)
- quantity is max(1, q); seenAt parses lastSeen (market-normalization.ts:41-43)
- listing key = seller:serverRegion:serverIdentifier:slot:name:level:price (market-normalization.ts:4-14)
- sales sort cheapest first, buy orders highest first, then newest (market-normalization.ts:68-70)

**INV-004 Keep per-item price history.** The console remembers, per item name, the lowest price ever seen, the most recent price, the current market low and the highest public WTB, for the dashboard and for pricing.

Rules:

- history is keyed by item name only; level is kept beside each price (commerce/price-history.ts:24-35)
- the current market low uses only ALData listings seen in the last 120 000 ms; an item with none loses marketLow (price-history.ts:46-53, 64-73)
- highestPublicWTB comes from ALData trades with wtb.price >= 1 (price-history.ts:82-113)
- nearby stand reports also write lowest and recent price at report time, only when lowest or recent changes (commerce/local-market.ts:22-64)

Settings:

- standPriceHistory (local-market.ts:7)

**INV-005 Publish the party's buy and sell listings to ALData.** With a valid ALData key the console publishes its standing bids, configured stand sales and anniversary slice barters, batching changes and re-publishing at least hourly.

Rules:

- publish needs the merchant's account owner id, a key and auth 'CORRECT' (commerce/aldata-service.ts:100-102)
- it PUTs /trades/<owner>/<key> with displayName = merchant and the listings (aldata-service.ts:105-113)
- schedule() batches changes into one publish 5000 ms after the first change (commerce/publication-scheduler.ts:9-15)
- listings: one barter per missing anniversary slice when a native slice is tradable, one WTB per stand bid (note names exact or minimum level), one WTS per configured sale that is not paused (commerce/public-listings.ts:28-75)
- a merchant status report re-publishes when auth is CORRECT and the last publish is older than 3 600 000 ms (status/composition.ts:103-110)

Settings:

- aldata.key and aldata.auth (http/market-account-actions.ts)
- standBids, standListings (public-listings.ts:66-74)

Handed over by other specs: 8 functions (13-lifecycle).

**INV-006 Track Ponty's secondhand stock across realms.** The console reads Ponty's stock on every realm from ALData each minute and from the merchant's own Ponty visits, preferring the merchant's fresh local view for its realm.

Rules:

- refreshes from ALData /npcs/Ponty every 60 000 ms once the merchant catalog is known; drops realms the account cannot resolve (commerce/market-feeds.ts:63-72, commerce/ponty.ts:61-68, application.ts:1367)
- normalize keeps items with an rid and a computed price; key = region:identifier:rid; groupKey is the item JSON without rid, q and price (scripts/ponty-market.cjs:1-5, 36-53)
- unit price: g x 0.6 (x1 for cash items), divided by markup, raised per upgrade or compound tier with scroll costs, /8 for expiring items, 1 for gifts, then x2 (x3 for cash) (ponty-market.cjs:6-35)
- a status report's ponty block is only taken from the merchant; the key uses the reported server (status/ponty.ts:20-65)
- local listings count as fresh for 30 000 ms and replace every remote listing of that realm, even an empty stand (ponty.ts:29-41)
- a dismissed listing stays hidden for 120 000 ms (ponty.ts:54-59)
- every rebuild from a remote refresh or a local report re-runs Ponty bid matching (ponty.ts:51, 71)

**INV-007 Choose which Ponty lots to buy.** Given a wanted quantity, the console picks Ponty lots that add up to it exactly, preferring the merchant's current realm, or takes what fits when partial buys are allowed.

Rules:

- listings sort current realm first, then realms with more stock, then realm name, smaller lots, cheaper unit price (scripts/ponty-market.cjs:66-77)
- selectLots runs a subset sum for an exact total; quantity must be a safe integer from 1 to 100 000 (ponty-market.cjs:54-65)
- with allowPartial it takes every lot that still fits, never a lot larger than the remainder (ponty-market.cjs:78-89)
- bid matching passes the merchant's status server and allowPartial = true (commerce/purchase-composition.ts:27-33)

**INV-008 Record stand sales and merchant milestones from status.** Comparing two merchant reports, the console logs and records stand sales, bank entry, anniversary cake crafts, deaths and stand opening.

Rules:

- a sale is seen only while the stand stayed open and gold went up (status/merchant-observation.ts:150-151)
- sold quantity = whole stack when the slot emptied or changed item, else the q drop (merchant-observation.ts:90-96)
- the matching listing shrinks or is removed; then persist and ALData publish (merchant-observation.ts:100-142)
- 'Entered bank' logs when the map matches bank or bank_<x> and did not before (merchant-observation.ts:27-46)
- a new anniversaryState.craftResult.at logs the cake craft result (merchant-observation.ts:31-33, 48-60)

**INV-009 Hide ignored market items.** The dashboard can hide items by name and level from market views; a shared helper defines listing freshness.

Rules:

- key = name|level; name 1-80 of [a-z0-9_], level 0-100 (runtime/market-preferences.ts:7, 11-16)
- marketListingFresh: seenAt within 120 000 ms (market-preferences.ts:8-10)
- at most 2048 ignored items (http/market-ignored-items.ts:13)

Settings:

- marketIgnoredItems (http/market-ignored-items.ts:4)

Handed over by other specs: 1 functions (13-lifecycle).

### Bids

**INV-010 Buy from nearby player stands that meet a standing bid.** When the merchant reports nearby stands, the console queues one 'stand bid purchases' job for the highest priority bid that a listing meets.

Rules:

- skipped when automation 'stand bid purchases' is false or the merchant already has a current job (commerce/local-market.ts:93-94)
- a listing qualifies when a bid for that item has quantity > 0, no bid job for it is pending, price <= bid price, and the level matches (local-market.ts:66-75)
- level rule: acceptHigherLevels false means exact level, otherwise level >= minimumQuality (commerce/bid-matching.ts:4-7)
- picks the item with the highest job priority, then the cheapest listing, and fills up to the bid quantity across listings (local-market.ts:95-102, 77-87)
- the job has no homeRealm and is not stamped (local-market.ts:104-111)

Settings:

- merchantAutomations['stand bid purchases'] (local-market.ts:93)
- standBids[item]: price, quantity, minimumQuality, acceptHigherLevels, priorityOverride (bids.ts:6-15)

**INV-011 Buy from ALData stands and Ponty to fill standing bids.** After each market or Ponty refresh the console queues a purchase job for the first bid, in priority order, that remote listings can fill.

Rules:

- both stop when automation 'stand bid purchases' is false or there is no merchant (commerce/bids.ts:134-139, 186-193)
- a bid is eligible with quantity >= 1 and no pending bid job for that item in current or queue (bids.ts:89-91, 52-54)
- Ponty: needs a Ponty rebuild within 30 000 ms; candidates match name, unit price <= bid, level rule, not PVP, seen within 120 000 ms; one job per call (bids.ts:133-156, 93-103)
- ALData: at most one 'ALData marketplace purchases' job in current or queue; candidates exclude the merchant's own stand, blacklisted sellers, PVP and listings older than 120 000 ms; cheapest first up to the bid quantity (bids.ts:158-202)
- each job copies state.activeRealm into homeRealm at queue time (bids.ts:113)
- after queueing: persist and dispatch (bids.ts:129-130)
- none of these reads a gold reserve; the character checks gold at purchase time (inference)

Settings:

- merchantAutomations['stand bid purchases'] (bids.ts:135, 186)
- standBids (bids.ts:20)

Handed over by other specs: 12 functions (13-lifecycle).

**INV-012 Count filled bid quantity.** When a purchase or a native WTB fill lands, the console lowers the bid's remaining quantity, deletes a finished bid, drops duplicate queued bid jobs and republishes.

Rules:

- fulfill needs a bid that accepts the item's level (commerce/bids.ts:62-70)
- quantity = max(0, quantity - amount); a zero bid is deleted (bids.ts:72-74)
- removes every queued bid purchase job for that item under any of the three automatic reasons (bids.ts:41-45, 56-60, 75)
- schedules an ALData publish and logs 'WTB filled' (bids.ts:76-85)

Handed over by other specs: 1 functions (02-movement).

**INV-013 Back off from sellers that fail.** A seller whose listing could not be bought is blocked for automatic purchases with a doubling cooldown; strikes stay until cleared.

Rules:

- identity key = seller (or name)|serverRegion|serverIdentifier; a record with empty region and identifier is a wildcard for that seller (commerce/merchant-blacklist.ts:3-17)
- a record blocks while until is -1 or in the future; manual purchases only honour records with reason 'manual' (merchant-blacklist.ts:18-23)
- each failure adds a strike; cooldown = 2^(failures-1) minutes (merchant-blacklist.ts:27-46)
- automatic blocking is off when autoBlacklistMerchants is false (application.ts:1439)

Settings:

- merchantBlacklist (application.ts:1439)
- autoBlacklistMerchants, default on (application.ts:1439)

Handed over by other specs: 3 functions (13-lifecycle).

**INV-014 Track per-listing progress of a purchase visit.** While the merchant walks a purchase route, the console marks bought listings, cancels a failed seller across the current and queued jobs, and folds the same seller's queued listings into the current visit.

Rules:

- complete adds the key to completedListingKeys, copies them onto the live command and stamps heartbeatAt and progressAt (commerce/purchase-progress.ts:58-66)
- cancelSeller marks every unfinished listing of that seller done, records a blacklist strike unless blacklisting is off, and strips that seller from queued ALData purchase jobs (purchase-progress.ts:67-111)
- additional pulls the same seller's listings out of queued ALData purchase jobs into the current job and the live command (purchase-progress.ts:112-156)
- only 'ALData marketplace purchases' jobs count as queued purchases (purchase-progress.ts:51-55)

Settings:

- autoBlacklistMerchants via blacklistingEnabled (purchase-progress.ts:87-88)

Handed over by other specs: 15 functions (13-lifecycle).

**INV-015 Queue manual stand, ALData and Ponty orders.** Dashboard orders become merchant jobs: a stand purchase list, one ALData buy or sell, or one Ponty job per realm.

Rules:

- stand: one 'stand purchases' job with the chosen listings (commerce/manual-orders.ts:54-61)
- ALData buy or sell: amount = min(quantity, listing quantity); homeRealm = state.activeRealm at queue time (manual-orders.ts:62-73)
- Ponty candidates: requested keys, not already in a Ponty job, not PVP, seen within 120 000 ms, unit price <= max price; cheapest first (manual-orders.ts:87-114)
- Ponty jobs: one per realm SR_<region><identifier>, pontyPlanned true, homeRealm = activeRealm at queue time (manual-orders.ts:115-141)
- every manual job has manual: true; finish logs, persists and dispatches (manual-orders.ts:39-53)

Handed over by other specs: 10 functions (13-lifecycle).

**INV-016 Advertise bids as native WTB stand offers.** The merchant's own stand can carry up to 16 native buy offers for standing bids; the console reserves, places, follows and removes them from the merchant's stand observations.

Rules:

- allocation: bids with useStandSlot first, then (with autoStandBuys) others not suppressed, by priority (override, else routine priority, else 75), limited to 16 minus live sales minus explicit bids (commerce/native-stand.ts:37-47)
- an offer quantity is min(bid quantity, 99 for upgradeable or compoundable items, else 9999) (native-stand.ts:155-162)
- placement refuses level > 12 or price > 99 999 999 999, a full inventory, and too little gold (waits for bank gold when bank plus carried covers it) (native-stand.ts:163-170)
- one new offer per plan, only with the stand open and nothing to remove (native-stand.ts:174-196)
- an offer that no longer matches the bid (revision, price, level, quantity) moves to removing; blocked offers are skipped (native-stand.ts:149-154, 190-193)
- fill evidence = max(acknowledged, receipt quantity, slot quantity drop on the same rid); each delta calls bid fulfil when the bid revision still matches (native-stand.ts:80-95)
- an offer follows its rid when trade slots move; a different rid at the slot resets or deletes the offer (native-stand.ts:107-125)
- an unconfirmed placement without rid is released 10 000 ms after it blocks (native-stand.ts:76-79, 126-133)
- a pending native purchase removes that item from the allocation and records 'Purchase outcome unconfirmed' (native-stand.ts:187-194)
- displacing an occupant pauses a sale or suppresses a bid's stand slot (native-stand.ts:55-63)

Settings:

- autoStandBuys (native-stand.ts:44)
- standBids[item].useStandSlot, standSuppressed, priorityOverride, revision (native-stand.ts:39-61)
- merchantRoutinePriorities['stand bid purchases'], default 75 (native-stand.ts:39)
- nativeStand ledger (native-stand.ts:34-36)

Handed over by other specs: 13 functions (13-lifecycle).

### Mail

**INV-017 Read the account inbox.** The console lists mail addressed to the account's characters through the game's account API every 30 s, and offers collect and delete actions.

Rules:

- posts to https://adventure.land/api/<method> with the session cookie and a 20 000 ms timeout (commerce/mail-startup.ts:43-58)
- a reply with an error or ui_error entry, failed, or success false throws its message (commerce/mail-api.ts:10-29)
- refresh pages through pull_mail cursors, keeps mail whose recipient matches an account character, parses string attachments, and fails on a repeated cursor (scripts/mail-inbox.cjs:15-48)
- one refresh at start, then every 30 000 ms; the timer does not hold shutdown (mail-startup.ts:75-82)
- collect queues a 'collect mail' job unless one exists; refuses mail being deleted or still processing (mail-inbox.cjs:49-60)
- remove needs the attachment taken and no collect job, calls delete_mail, then refreshes (mail-inbox.cjs:61-77)
- collection status per mail: collected, collecting, queued or the last outcome (mail-inbox.cjs:6-13)

Handed over by other specs: 4 functions (13-lifecycle).

**INV-018 Auto collect, auto delete and read marks.** Optional automation collects attachments and deletes collected mail on each refresh; the console keeps read marks and a sent-mail history.

Rules:

- autoCollect queues collection for untaken attachments; a failed collection retries after 30 000 ms (commerce/mailbox.ts:26-28)
- autoDelete removes mail whose attachment is taken (mailbox.ts:29)
- mail already being collected is skipped (mailbox.ts:27, mail-startup.ts:73)
- seen() keeps the newest 2000 read ids (mailbox.ts:6, 39)
- sent() prepends an outbox record once per id; removeSent deletes one (mailbox.ts:40-42)
- configure needs both booleans (mailbox.ts:37)

Settings:

- mailbox.settings.autoCollect, default false (mailbox.ts:10)
- mailbox.settings.autoDelete, default false (mailbox.ts:10)
- mailbox.seenIds, mailbox.outbox (mailbox.ts:11-12)

**INV-019 Send and collect mail through the merchant.** Sending mail or collecting an attachment is a merchant job; an attachment held by a BankBoi is first staged to the merchant.

Rules:

- send queues 'send mail'; a source in a BankBoi pack sets blockedOnBankboi, adds a withdrawal with mailJobId, then starts the BankBoi service (commerce/mail-jobs.ts:38-61)
- collect needs a merchant and queues a manual 'collect mail' job (mail-jobs.ts:76-90)
- entry resolves a source from the merchant inventory, a BankBoi or the bank snapshot (mail-jobs.ts:32-37)
- postage is read from the downloaded official client HTML; no match gives null, never a guess (scripts/mail-postage.cjs:2-5, application.ts:652-655)

Handed over by other specs: 12 functions (13-lifecycle).

### Item identity and marks

**INV-020 Decide when two items are the same.** Marks, rules and receipts compare items through a few shared helpers: a partial match that ignores stack size, and string keys for automatic rules.

Rules:

- sameMarkedItem compares only the keys present on the second item and ignores q, price, rid, b and giveaway, so a stack size change keeps a mark (inventory/item-identity.ts:3, 10-18)
- markedItem unwraps {slot, item} marks and returns slotless marks as the item itself (item-identity.ts:5-7)
- autoItemRuleKey = name@+level (item-identity.ts:20-24)
- autoItemRuleMode reads name@+level, and falls back to a legacy name-only rule only for +0 items (item-identity.ts:26-35)
- automaticCommerceRuleKey = JSON of name, level, p and stat_type for NPC, stand and deconstruction rules (item-identity.ts:37-44)

**INV-021 Join per-copy meta with the merchant catalog.** Reports carry only per-copy item meta; readers add the per-type definition from the merchant catalog through one cached join.

Rules:

- one index per accepted catalog object, keyed by item id (inventory/catalog-meta.ts:30, 35-48)
- joinItemMeta overlays the report's own meta on the catalog meta and caches the result per report object (catalog-meta.ts:60-70)
- entryMeta is the shorthand for {item, meta} entries in items, slots, bank packs and listings (catalog-meta.ts:73-78)

**INV-022 Keep bank and merchant collection marks in step with inventory.** On each inventory report the console moves manual marks with their item, drops marks whose item left, and paints automatic bank or merchant marks from the standing rules.

Rules:

- a manual slot mark follows its item to a new slot; a slotless manual mark stays while any matching item exists (inventory/collection-marks.ts:15-30)
- an automatic mark stays only while the same item sits in that slot and its rule still says that mode (collection-marks.ts:32-46)
- for the merchant, copies kept for NPC sales count as bank (collection-marks.ts:6, 47-49; mark-reconciliation.ts:40)
- a manual mark on a copy beats the standing rule for that copy; painting a mode removes the other mode's mark on that slot (collection-marks.ts:63-88)
- with shared merchant rules, automatic marks with conflicting rules are dropped, and items with processing pending are not banked (mark-reconciliation.ts:42-50)
- reconcile skips characters outside the shared rule set (application.ts:1517)
- settings restore marks from the selection document first, then legacy settings; itemCollectionThreshold and buyUpgradeBatchSize clamp to 1-42, threshold defaults to 100 000 (inventory/initial-collection.ts:15-35)

Settings:

- marked, merchantMarked, autoItemMarks (initial-collection.ts:17-19)
- threshold default 100000; itemCollectionThreshold default 1, range 1-42; buyUpgradeBatchSize default 1, range 1-42 (initial-collection.ts:27-32)

**INV-023 Mark items for bank or merchant from the dashboard.** The dashboard toggles one-off bank or merchant marks on a slot and sets or clears standing automatic bank or merchant rules.

Rules:

- 'mark' toggles a bank mark on a slot and removes a merchant mark on that slot; 'merchant-mark' does the reverse (inventory/mark-commands.ts:68-97)
- 'auto-item-mark' toggles the rule, or sets it idempotently with action 'set'; a +0 rule also deletes the legacy name-only rule (mark-commands.ts:29-52)
- 'clear-auto-item-marks' removes every rule of that mode; 'remove-auto-item-mark' removes one rule key (mark-commands.ts:59-63)
- after a rule change it reconciles every shared member and persists (mark-commands.ts:43-45, 64-65)
- a rule goes to ruleOwner: the merchant when shared rules are on, else the character (shared-rules.ts:20-22)

Settings:

- autoItemMarks[owner][name@+L] = 'bank' | 'merchant' (mark-commands.ts:56)

Handed over by other specs: 17 functions (13-lifecycle).

**INV-024 Reconcile automatic marks and sales on each status report.** Merchant scheduling calls these hooks on every report so automatic collection, upgrade, compound and sale marks follow the live inventory.

Rules:

- item marks: reconcileAutoItemMarks, skipped for non-members (application.ts:1513-1519)
- upgrade marks: compound groups first, then upgrade marks; either change counts (application.ts:1528-1535)
- sales: deconstruction reconcile, then automatic merchant sales (application.ts:511, 1499-1503)

Handed over by other specs: 1 functions (02-movement).

**INV-025 Give each item one automatic action.** Choosing an automatic action for an item (bank, upgrade, compound, NPC sale, stand sale, exchange, deconstruction) retires that item's other automatic rules and their reservations.

Rules:

- every remover except the chosen one runs; choosing merchant keeps bank collection rules (inventory/automatic-action.ts:120-128)
- removers cover collection rules and auto marks, upgrade rules, compound rules by name, NPC sale rules and marks, stand rules and listings (merchant only), exchange rules and queued exchange lines (merchant only), deconstruction rules and marks (automatic-action.ts:40-108)
- reservations tied to removed sale or deconstruction ids leave merchantMarked and withdrawals (automatic-action.ts:109-118)
- any change sets itemMarksCleared on the current merchant job (automatic-action.ts:129)
- an exchange reward goes to the first active of exchange, NPC, stand, pending upgrade, pending compound, deconstruction; otherwise to bank (automatic-action.ts:142-153)

Settings:

- autoExchanges keyed name@L; autoNpcSales, autoStandMarks, autoDeconstruction keyed by automaticCommerceRuleKey (automatic-action.ts:99, 66-93)

Handed over by other specs: 4 functions (13-lifecycle).

**INV-026 Clear every mark and rule on one item.** The dashboard 'clear marks' action removes every manual mark, automatic rule, sale listing, compound group, exchange rule and merchant weapon choice for the selected item, before reconciliation can recreate them.

Rules:

- refuses with 409 'Item changed; refresh and try again' unless the live entry equals the posted item exactly (inventory/clear-item-marks.ts:187-189)
- bank selections only work for the merchant and also clear bank-sourced upgrades, sale marks and withdrawals at that pack and slot (clear-item-marks.ts:42-59)
- upgrade marks match when the live level is within the mark's start to start + tiers (clear-item-marks.ts:88-93)
- automatic rules for the item are removed for every shared member; NPC, deconstruction, stand and exchange rules are removed for the rule owner (clear-item-marks.ts:95-141, 204-208)
- the merchant weapon choice clears when it is the same item (clear-item-marks.ts:125)
- when anything changed it sets itemMarksCleared on a current job of one of ten improvement or sale reasons (clear-item-marks.ts:71-75, 196)

**INV-027 Share automatic rules across the party.** A one-time migration moves every member's automatic rules under the merchant; conflicting choices are kept for the user to resolve.

Rules:

- migration runs once, only with a merchant and no existing merchantRules; it stores a backup of the original rule documents (inventory/shared-rules.ts:60-79)
- for each key the merchant's choice wins; identical choices (ignoring createdAt) merge; otherwise a conflict is recorded and no rule is set (shared-rules.ts:26-32, 134-137)
- item keys without @+ become name@+0; upgrade rules normalize to {tiers, quantity, default -1} (shared-rules.ts:144-155)
- POST /party-api/merchant/rule-conflict applies one owner's choice; 404 when it no longer exists (shared-rules.ts:81-101)
- itemRuleConflicts reports when more than one of processing, NPC sale, stand sale and deconstruction applies (shared-rules.ts:111-120)
- processingPending: an active offering wait or unfinished pass, an active upgrade rule, or an active compound rule below its target tier (shared-rules.ts:126-130, 159-169)
- sharedMember: everyone without shared rules; with them, members and the merchant (shared-rules.ts:23-25)

Settings:

- merchantRules {version 1, owner, members, backup, conflicts} (shared-rules.ts:8)

**INV-028 Release marks when an item leaves a slot.** When the merchant gives or delivers an item, its bank, merchant, upgrade and compound reservations on that slot go away; incoming compound reservations clear when the full item arrives.

Rules:

- remove drops bank marks by slot (or by full JSON for slotless marks), merchant marks and unequipped upgrade marks on the slot, and compound members on the slot (inventory/reservations.ts:28-40)
- empty compound groups are removed (reservations.ts:20-26)
- clearIncoming matches the full serialized item, stack size included (reservations.ts:42-45)

### Upgrades

**INV-029 Set manual and automatic upgrade targets.** The dashboard marks one item for a number of upgrade tiers, or sets a standing rule that upgrades every copy of an item and level, optionally with a quota.

Rules:

- tiers must be a whole number from 1 to 13 - level (inventory/upgrade-commands.ts:46-50)
- a manual mark gets a random requestId and an optional offering; a manual offering needs tiers 1 and stock in merchant, bank or BankBoi (upgrade-commands.ts:74-86, 188-193)
- an automatic rule stores {tiers, quantity}; quantity is kept when tiers stay the same, else -1 (unlimited) (upgrade-commands.ts:97-121)
- 'update-auto-upgrade-rule' changes tiers or quantity (-1 or >= 1), or removes the rule and its auto marks (upgrade-commands.ts:122-158)
- a saved mark queues a 'manual upgrades' or 'auto upgrade' bank job (upgrade-commands.ts:90-93)
- 'gold-target' stores a whole amount up to 1 000 000 000 000 (upgrade-commands.ts:159-170)
- on restart a manual mark without requestId takes its passId or a new UUID (inventory/initial-intents.ts:22-33)

Settings:

- upgrades[name] (marks), autoUpgradeMarks[owner][name@+L] = {tiers, quantity} (upgrade-commands.ts:22-23)
- goldTargets[name] (upgrade-commands.ts:167)
- upgradeOfferingRules, statScrolls, purchases, compounds, autoCompounds, autoExchanges restored by initialItemIntents (initial-intents.ts:25-31)

**INV-030 Keep automatic upgrade marks on the right copies.** From each report the console keeps automatic upgrade marks on copies still inside their pass, moves a mark when its item moved, adds marks for new copies up to the quota, and drops resolved passes.

Rules:

- skips a report without items or with upgradeInventoryBusy set (lucky slot swaps hide the item) (inventory/mark-reconciliation.ts:61-63)
- stock reserved for crafts and items with conflicting shared rules are left out (mark-reconciliation.ts:67-68)
- an automatic mark stays while the live item is between start and start + tiers and its rule is active with the same tiers (inventory/upgrade-marks.ts:38-50, 152)
- a displaced mark moves only when exactly one unclaimed copy fits (upgrade-marks.ts:139-150)
- a bank-sourced mark binds to the withdrawn copy once storageReceived is set (upgrade-marks.ts:111-120)
- new marks go on upgradeable, unlocked, unbound copies until the rule's quantity of auto marks exists (-1 = no limit) (upgrade-marks.ts:52-102, 153)
- clearResolved removes marks by requestId, then passId, then full JSON, with a legacy match that ignores passId (upgrade-marks.ts:128-136)

Settings:

- autoUpgradeMarks (upgrade-marks.ts:20-21)

**INV-031 Choose an offering per item and level range.** Offering rules say which offering (Primling, Primordial Essence, Primordial X) to add for an item between two levels, and whether the upgrade must wait for it.

Rules:

- a rule covers floor <= level < ceiling; ranges for one item may not overlap (runtime/upgrade-offerings.ts:17-26)
- an explicit per-attempt offering overrides the rules and counts as required (upgrade-offerings.ts:21-23)
- valid ranges: 0 <= floor < ceiling <= 13 (upgrade-offerings.ts:34-37); the command also caps ceiling at the catalog maxLevel, default 13 (inventory/upgrade-offerings.ts:9-12, 34-40)
- overlap returns 409 'There is already a rule that covers +F to +C' (inventory/upgrade-offerings.ts:28-29)
- offering stock counts unlocked, unbound offerings in merchant inventory, bank and complete BankBoi stacks (inventory/offering-stock.ts:5-12)

Settings:

- upgradeOfferingRules [{id, name, floor, ceiling, offering, required}] (upgrade-offerings.ts:6-13)

**INV-032 Fetch offerings from storage for a running upgrade job.** When the merchant needs an offering it does not carry, the console checks the request against the live job, counts the remaining offering steps, queues withdrawals from bank or BankBoi, and pauses the job until they arrive.

Rules:

- the route refuses (409) unless the job id and command id match the current job and the item and mark are admitted and authorized (inventory/offering-supply.ts:19-46)
- demand counts unfinished steps per admitted live copy whose resolved offering is the requested one; an explicit offering counts one step; carried stock is subtracted (offering-supply.ts:101-137)
- bank continuation rules admit up to 3 more copies into the command (offering-supply.ts:143-160)
- withdrawals prefer bank panes over BankBoi stacks and never split an existing request (inventory/storage-service.ts:31-46)
- a pending supply stores offeringSupply on the job; the job waits until the merchant carries the outstanding offerings or the rules change (offering-waits.ts:55-69)
- pause reasons: 'Waiting for confirmed merchant collection', the BankBoi worker error, or 'Waiting for BankBoi service and native deposit' (offering-waits.ts:70-77)
- bank collection jobs that carry offering supply wait until the merchant has more than 3 free slots (offering-waits.ts:117-135)
- a wait with no offering stock is recorded on the mark with a signature of rules, stock, BankBoi and inventory; the mark is ready again when the signature changes (offering-waits.ts:7-36)
- a non-BankBoi withdrawal queues 'manual bank exchange' (application.ts:601-605)

Settings:

- upgradeOfferingRules (offering-supply.ts:12)

**INV-033 Journal each upgrade and compound attempt.** Before every upgrade or compound the merchant registers an attempt with the console; one unfinished attempt blocks new ones until the merchant finishes it or the user resolves it.

Rules:

- POST /party-api/merchant/production accepts only the merchant; actions pending, inspect, resolve-unknown, wait-offering, abort-manual, checkpoint, complete, else begin (inventory/production.ts:134-156)
- begin validates id (<= 200 chars), name, target level 1 to 13 and kind; a repeated id must keep its identity (production.ts:56-63, 76-81, 221-224)
- any unfinished attempt throws 'Production recovery pending' (production.ts:82)
- automatic attempts throw when the rule is gone or its quota is 0 (production.ts:50-55); conflicting shared rules throw (production.ts:85)
- offering guards: a manual request must still exist with the same offering and item; a required rule offering must be present; an unexpected offering throws (production.ts:244-264)
- checkpoints only move the journal forward through prepared, running, complete; slots must be 0-41 (production.ts:97-114)
- success lowers each matching quota rule by 1 when its signature is unchanged (production.ts:231-237)
- completed receipts are kept up to 2048, newest first; unfinished ones are never pruned; prune runs on begin, finish and resolve (production.ts:65-72, 74, 132, 198)
- completed commerce journals stay within that cap so paid progress can replay (production.ts:116-118, 125-128)
- resolve-unknown needs a reason of 1-1000 chars and never spends quotas (production.ts:187-202)
- errors return 409 with String(error) (production.ts:154)

Settings:

- production.attempts (persisted) (production.ts:12)

**INV-034 Carry an upgrade pass across attempts.** The console saves the original target of a multi-tier pass before production and advances or retires it from completed journals, so a retry never reinterprets the target.

Rules:

- automatic continuations need passId <= 200 chars, an integer slot, matching rule key and tiers, and a live item inside the pass (inventory/upgrade-continuation.ts:20-34, 48-58)
- manual continuations match by requestId, or legacy passId when the mark has no requestId (upgrade-continuation.ts:35-47)
- a complete journal retires the mark when destroyed or at target; otherwise records liveSlot and liveItem (upgrade-continuation.ts:61-78)
- intent matches by requestId, else passId (upgrade-continuation.ts:80-83)

**INV-035 Upgrade items straight from the bank.** A bank withdrawal can carry an upgrade target; the pass becomes active once the merchant's native withdrawal receipt confirms the source.

Rules:

- only the merchant may attach upgradeTiers; the bank entry must match, be upgradeable, unlocked and unbound, with tiers + level <= 13 (inventory/transfer-commands.ts:144-156)
- the mark is stored with slot -1 and storage {pack, slot}; an existing one updates tiers (transfer-commands.ts:157-166)
- a bank receipt with the same pack, slot and item (both directions) sets storageReceived (inventory/bank-upgrade-receipts.ts:5-15)

**INV-036 Estimate gold and scrolls for buy-and-upgrade orders.** For a buy order with a target level the console simulates 3000 deterministic upgrade runs and quotes the 90th percentile gold cost.

Rules:

- default success tables per grade 0-2 (runtime/upgrade-estimate.ts:24-28)
- 3000 runs per line, a shared budget of 60 000 000 rolls, fewer than 30 finished runs means unavailable (upgrade-estimate.ts:105-167, 78)
- quote = the run at ceil(0.9 x runs) - 1 by gold (upgrade-estimate.ts:160-166)
- grace model: failure adds grace to nearby levels; chance bonus saturates at 14 (upgrade-estimate.ts:186-200)
- default scroll costs 1000, 40 000, 1 600 000, 64 000 000 (upgrade-estimate.ts:178)
- results cache by canonical key, at most 256 batches (upgrade-estimate.ts:58-96)

**INV-037 Preview upgrade chances with each offering.** The merchant asks the game server for the upgrade chance with no offering and with each offering, and returns a reason when one is not possible.

Rules:

- the item must match the request and stay unchanged during the preview (runtime/characters/upgrade-preview.ts:16-30)
- uses scroll<grade> from merchant inventory; a missing offering gives 'Offering not in merchant inventory' (upgrade-preview.ts:31-42)
- the server reply must echo calculate, scroll, offering and item (upgrade-preview.ts:43-47)
- game error codes map to text: cant_in_bank, distance, upgrade_in_progress, item_locked (upgrade-preview.ts:48-53)

### Compounds

**INV-038 Mark compound triplets and set auto compound rules.** The dashboard groups three matching copies for one compound, from inventory or from the merchant's bank, or sets a standing rule to compound an item up to a target tier.

Rules:

- a manual group takes the selected copy plus two more of the same name and level not already grouped; fewer than 3 gives 409 (inventory/compound-commands.ts:76-123)
- a bank group needs three unlocked, unbound, compoundable copies in items<N> packs not reserved (compound-commands.ts:86-101)
- auto rule tier 1-7, quantity -1 or >= 1 (compound-commands.ts:63-65, 124-143)
- clearing all auto compounds also drops queued 'auto compound' jobs; clearing all auto upgrades also drops auto marks; both only for the merchant (compound-commands.ts:144-165)
- a group keeps its copies across slot moves when every copy can be placed, never two in one slot (inventory/compound-marks.ts:13-45)

Settings:

- compounds[name] groups; autoCompounds[owner] [{name, targetTier, quantity}] (compound-commands.ts:25-26)

**INV-039 Bank compound leftovers that cannot form a triplet.** While waiting for an auto compound group, the merchant banks copies beyond complete batches of three.

Rules:

- per active rule and level below the target, keeps floor(stock / 3) x 3 inventory copies and returns the rest (runtime/compound-storage.ts:5-18)
- the merchant visits the bank, then deposits one leftover at a time, recomputing after each (runtime/characters/compound-storage.ts:13-29)

Settings:

- autoCompounds (compound-storage.ts:9)

### Exchange

**INV-040 Pull exchange stock from BankBoi storage.** When an exchange job is short of an item, the console queues whole-stack retrievals from BankBoi workers in storage order.

Rules:

- only shortages that match a job exchange line by id and level count (inventory/exchange-storage.ts:21-23, 67-79)
- whole stacks are requested until the shortage is covered; an existing request for that pack and slot is not repeated (exchange-storage.ts:36-64)
- the coordinator persists when anything is pending (inventory/storage-service.ts:15-30)
- auto exchange scheduling runs through improvementScheduler.exchange (application.ts:1625-1627)

Handed over by other specs: 7 functions (13-lifecycle).

**INV-041 Show exchange reward odds.** The character computes each possible exchange reward and its chance from the game's weighted drop tables, following nested tables.

Rules:

- chance = weight / table total, multiplied through 'open' rows; a table already on the path is skipped (runtime/characters/exchange-rewards.ts:10-31)
- cosmetic rows count 1; gold, shells and empty get labels (exchange-rewards.ts:32-44)
- identical rows merge their chances; results sort by chance (exchange-rewards.ts:45-52)

Handed over by other specs: 1 functions (02-movement).

**INV-042 Merchant weapon, exchanges and buy-copy requests.** The dashboard picks the merchant's preferred weapon, toggles auto exchange for an item, queues a one-off exchange (with a pickup from another character), or asks for a copy to be bought.

Rules:

- the weapon must be type weapon with wtype in mace, staff, bow, spear, short_sword, fist, dartgun, dagger, axe, basher (inventory/merchant-item-commands.ts:31-45, 70-77)
- auto exchange toggles autoExchanges[name@level] for exchangeable non-reward lines (merchant-item-commands.ts:78-93)
- a one-off exchange needs floor(q / required) >= 1, an unprotected item without a collection mark; another character's copy adds an 'exchange pickup' job (merchant-item-commands.ts:94-118)
- the live entry must equal the posted item exactly, else 409 (merchant-item-commands.ts:125-126)
- 'buy-copy' appends {name} to purchases[name] (merchant-item-commands.ts:133-136)

Settings:

- merchantWeapon {item} (merchant-item-commands.ts:74)
- autoExchanges (merchant-item-commands.ts:88)
- purchases (merchant-item-commands.ts:134)

### Transfers

**INV-043 Use, equip, give and withdraw items.** Dashboard item actions become character commands or merchant deliveries; bank withdrawals become withdrawal requests that the merchant or BankBoi serves.

Rules:

- use-item, equip and unequip set a one-shot command on the character (inventory/transfer-commands.ts:67-85, 203-206)
- a dashboard Equip of a merchant-compatible weapon on the merchant also sets merchantWeapon and releases its reservations; unequipping that weapon from mainhand clears it (transfer-commands.ts:55-66, 74-82)
- give from the merchant becomes a delivery entry (one per slot and item, moved to the new target); from another character it needs both on the same map, instance and server, seen within 10 000 ms and within 400 px, else 409 (transfer-commands.ts:86-116, 221-225)
- withdraw toggles a {pack, slot, item} request; markAll adds every matching stack from bank and BankBoi by storage identity (transfer-commands.ts:117-136, 167-197)
- an automatic bank rule on that item answers 409 code auto_bank_confirmation_required unless removeAutoBankMark is true, which removes the rule and its marks (inventory/withdrawal-bank-guard.ts:18-31)
- any BankBoi pack in the requests starts the BankBoi service (transfer-commands.ts:188-195)

Settings:

- merchantDeliveries, withdrawals, merchantWeapon (transfer-commands.ts:25-27)

Handed over by other specs: 7 functions (13-lifecycle).

**INV-044 Apply stat scrolls to equipment.** The dashboard marks inventory or equipped gear for a stat scroll; the console checks the scroll supply first.

Rules:

- inventory marks are only for the merchant; equipped marks use the character's primaryStat (inventory/stat-scroll-commands.ts:73-78, 155, 170)
- the item must accept stat scrolls (definition.stat) and the stat must be one of 23 supported (stat-scroll-commands.ts:38-59, 127-131)
- non-primary stats need 1, 10, 100 or 1000 scrolls by grade thresholds (default 9, 10, 11) in merchant inventory plus bank (stat-scroll-commands.ts:66-72, 86-105)
- scroll name = stat + 'scroll', mp_cost -> mpcostscroll (stat-scroll-commands.ts:63-65)
- an item that already has that stat_type answers 409 (stat-scroll-commands.ts:134-135)
- an inventory mark queues 'stat scrolls' (stat-scroll-commands.ts:125)

Settings:

- statScrolls[name] (stat-scroll-commands.ts:29)

Handed over by other specs: 1 functions (13-lifecycle).

### Lucky slot

**INV-045 Track upgrade rolls per inventory slot.** The character records every finished 4-digit upgrade roll by inventory slot and uses the statistics to search for the slot the server favours.

Rules:

- counts a q_data upgrade packet with num 0-41, an upgrade scroll and exactly 4 digits; a repeat of the last roll with the same or lower remaining time is ignored (runtime/characters/lucky-slot-tracker.ts:11-25, 39-49)
- per slot: totalRolls, sumRolls, rolls above 0.963, perfect rolls (roll 0) (lucky-slot-tracker.ts:50-54)
- the cursor moves to the next slot after each roll (lucky-slot-tracker.ts:55-56)
- each client keeps its own stream id; streams add up without double counting (runtime/lucky-slot-tracking.ts:16-30, 65-80)
- evidence model: 60% of lucky-slot rolls are max(U/10000, 0.975R - 0.012) (lucky-slot-tracking.ts:81-92)
- a slot is ruled out with >= 100 samples and 0.999 elimination confidence; the best slot is inferred at 0.999 probability with >= 100 samples (lucky-slot-tracking.ts:93-104, 110-130)
- select returns the inferred slot or the next slot from the cursor that is not ruled out; errors return null (lucky-slot-tracker.ts:66-69)

Settings:

- localStorage tracking per owner (lucky-slot-tracker.ts:27-38)

**INV-046 Lock, resume and share lucky slot evidence.** The coordinator stores each merchant's roll history, a user lock on one slot and a resume point, and tells the merchant which slot to use with each command.

Rules:

- reports merge per stream; a stream with no valid slots is ignored (status/lucky-slot-tracking.ts:35-43)
- a new account character id for a name drops that name's tracking, verified slot, lock and resume; evidence moves with an id that changes name (lucky-slot-tracking.ts:14-34)
- evidence counts only when the reported id matches (lucky-slot-tracking.ts:52-56)
- the resume point is released once its slot records more rolls than at unlock (lucky-slot-tracking.ts:44-51)
- each merchant command gets luckyUpgradeSlot = lock, else resume slot, else verified slot, else null (status/response.ts:134-140)
- a merged change persists (status/ingestion.ts:100-103)

Settings:

- luckySlotLocks[name], luckySlotResume[name] {slot, rolls}, luckyUpgradeSlots[name], luckySlotTracking, luckySlotCharacterIds (status/lucky-slot-tracking.ts:2-8)

Handed over by other specs: 1 functions (02-movement).

**INV-047 Upgrade in the lucky slot and put everything back.** For each upgrade the merchant swaps the item into the lucky slot, upgrades, and swaps it back, journaling every step so a crash or restart restores the layout.

Rules:

- the journal saves from, to, item, displaced contents and phase preparing, running or restoring, locally and as a production checkpoint (runtime/characters/lucky-upgrade.ts:2, 71-74)
- every swap must be confirmed by inventory within 5000 ms (lucky-upgrade.ts:75-92)
- failures carry code lucky_slot_unavailable and text 'Couldn't use lucky slot: <reason>' (lucky-upgrade.ts:65-68)
- the item, scroll and offering must not change during preparation (lucky-upgrade.ts:144-156, 206-207)
- restore adopts deliveries and potion use in the displaced stack, never recreates consumed units, and refuses a changed layout (lucky-upgrade.ts:23-60, 93-117)
- a lucky_slot_unavailable restore failure outside preparation abandons only the journal and leaves inventory as it is (lucky-upgrade.ts:123-138)
- tidy packs the bag so the lucky slot stays empty; slot 41 stays pinned for a tracker or supercomputer (lucky-upgrade.ts:216-244)
- only one upgrade owns the inventory at a time (lucky-upgrade.ts:157-161, 179)

Handed over by other specs: 2 functions (04-targeting, 05-survival).

### Bank

**INV-048 Keep one bank snapshot.** The bank contents come from whichever character last reported them; the console replaces its snapshot only when content or reporter changes, and persists bank state separately from settings.

Rules:

- a report without bank releases that character as observer (status/bank.ts:29-33)
- a carried (unchanged) bank object is skipped (bank.ts:19-26, 34-37)
- a change sets seenAt, adopts reserved BankBoi cargo and persists (bank.ts:38-45)
- BankBoi completion and checkpoint routes also write the snapshot directly (http/bankboi-storage.ts:47-51)
- restart restores snapshot, BankBoi workers, queue, transaction and withdrawals; the observer resets (inventory/initial-bank.ts:4-15)

Settings:

- bankSnapshot, bankbois, bankboiQueue, bankboiTransaction, bankboiReservedMigrated, withdrawals in the bank document (initial-bank.ts:6-12)

Handed over by other specs: 7 functions (11-settings, 13-lifecycle).

**INV-049 Know the bank vaults and how they unlock.** The console reads the vault list (floor, gold and shell cost, key) from the game files, and a character report may replace it.

Rules:

- parses var bank_packs from game_files/<version>/old_common_functions.js; failure logs a warning and returns [] (infrastructure/game-data.ts:16-38)
- bank_b needs bkey, bank_u needs ukey (game-data.ts:9-12)
- a status report with bankVaults replaces the list (status/catalogs.ts:74-80, status/composition.ts:97)

Handed over by other specs: 6 functions (11-settings, 13-lifecycle).

**INV-050 Serialize character bank visits.** Ordinary character bank and upgrade visits run one at a time; the command snapshots marks, withdrawals, upgrades and the gold target when it is sent.

Rules:

- one queued visit per name and type; dispatch only when no visit is current (inventory/bank-queue.ts:20-24, 47-54)
- an 'upgrade' visit carries upgrades, purchases and compounds; a 'bank' visit carries marks, withdrawals and goldTarget (bank-queue.ts:26-45)
- dispatch is held while a console update blocks the merchant (application.ts:2243-2246)

Handed over by other specs: 5 functions (13-lifecycle).

**INV-051 Fill and compact partial bank stacks.** The character deposits into existing partial stacks first and merges partial stacks, journaling each transfer so an interrupted move is never repeated.

Rules:

- stack identity = name, level, p, stat_type, data, rid, b, m, l (runtime/bank-stacks.ts:16-19)
- protected: any protection error, staging row items1 slots 35-41, bound items, placeholders, marked locations or items (bank-stacks.ts:20-25)
- deposit plans fill partial stacks before empty slots (bank-stacks.ts:33-45)
- each operation journals expected results and waits up to 5000 ms for them (runtime/characters/bank-stacks.ts:37-59)
- recovery waits for the recorded result, returns buffers, retires the journal after 30 000 ms and cools down 5000 ms after an error (characters/bank-stacks.ts:95-132)
- a partial transfer needs 2 free buffers, a merge 2 or 3 (characters/bank-stacks.ts:145-165, 208-209)
- fill, compact and recover run one at a time (characters/bank-stacks.ts:219-226)

Handed over by other specs: 4 functions (02-movement, 05-survival).

**INV-052 Carry unchanged inventory between reports.** Characters omit items, slots and bank while they match the revision the coordinator acknowledged; the coordinator puts the held fields back before anything reads the report.

Rules:

- a report with items stores items, slots and bank under its revision (status/inventory-carry.ts:23-31)
- a report without items and with a known revision gets the held fields back; an unknown revision is refused (inventory-carry.ts:33-38)
- the response names the held revision (inventory-carry.ts:42-45)

### BankBoi storage

**INV-053 Plan which BankBoi to service next.** The console picks the BankBoi worker to bring online and the requests it should carry: provisioning first, then staged cargo, retrievals, stacks with a better home, then unloads into the bank.

Rules:

- stack homes: the first partial stack per identity in bank (outside the staging row) then BankBoi workers (scripts/bank-stack-routing.cjs:11-25)
- a worker is available when ready, or in error with a retryable error after retryAt (bank-stack-routing.cjs:67-72, 80-82)
- no plan while a staging slot holds outgoing cargo reserved for withdrawal (bank-stack-routing.cjs:83-91)
- order: provisioning, staged requests it accepts, retrievals with free staging, stacks that belong elsewhere, an unload plan that changed since it was blocked (bank-stack-routing.cjs:93-97)
- at most 7 requests and 7 retrievals per transaction (bank-stack-routing.cjs:99-101)
- merchant status responses carry the stack homes (status/response-composition.ts:42)
- the BankBoi service plan includes workers still cooling down (application.ts:372)

**INV-054 Merge partial stacks in the merchant's bag.** At an idle or stand boundary the console plans one merge of two partial stacks in the merchant's inventory.

Rules:

- skipped while the merchant has a job, a BankBoi transaction runs, a retry is pending, or the merchant is banking, gathering, anniversary busy or dead (scripts/merchant-inventory-stacks.cjs:4-7)
- any item name referenced by marks, upgrades, compounds, stat scrolls, withdrawals, listings, sales, deliveries, cargo or the queue is left alone (merchant-inventory-stacks.cjs:8-17)
- PvP-marked loot (v) never merges with unmarked loot (merchant-inventory-stacks.cjs:24-26)
- returns the first pair whose sum fits the stack limit (merchant-inventory-stacks.cjs:27-29)

Handed over by other specs: 5 functions (13-lifecycle).

**INV-055 Swap the merchant's slot for a BankBoi.** To reach overflow storage the console stops the merchant, logs a BankBoi into its headless slot, lets it work, then restores the merchant.

Rules:

- starts only with a plan and a merchant seen within 10 000 ms, not gathering, not busy with a job or event, not anniversary busy (inventory/bankboi-service.ts:49-58; bankboi-composition.ts:65)
- mode: provision for a provisioning worker, retrieve with retrievals, else store (bankboi-service.ts:60-76)
- on failure to start it puts the merchant back (bankboi-service.ts:100-110)
- finish stops the BankBoi, reassigns the merchant, clears the BankBoi command, and queues 'manual bank exchange' when normal withdrawals remain (bankboi-service.ts:113-133; bankboi-composition.ts:80-86)
- a transaction older than 600 000 ms, or older than 120 000 ms with a worker unseen for 30 000 ms or not banking, is recovered (bankboi-service.ts:141-157)
- recovery marks the worker error 'interrupted' with a 10 000 ms retry (bankboi-composition.ts:61-64)
- a Steam login release stops the BankBoi, confirms it is offline, frees the slot and keeps pending items (bankboi-service.ts:160-179; application.ts:2389)
- withdrawals tied to a craft job that left the queue are pruned before planning (bankboi-composition.ts:45-55)
- a character slot counts busy while a BankBoi transaction runs or the character reported banking, stocking or upgrading within 5000 ms (characters/ownership.ts:79-81, 142-145)

**INV-056 Send the BankBoi its storage command.** When the replacement BankBoi first reports, the console records its inventory and sends one bankboi-service command with the planned requests and retrievals.

Rules:

- dispatch needs the transaction's BankBoi, phase waiting-for-bankboi and no existing command (status/bankboi.ts:49-57)
- the command carries provision flag, requests, retrievals, unload true, items protected for withdrawals from that BankBoi, reserved bank locations and stack homes (bankboi.ts:64-79)
- phase moves to processing and bank state persists (bankboi.ts:80-81)
- every BankBoi report records items, slots, gold and seenAt (bankboi.ts:40-45)

Handed over by other specs: 1 functions (07-hunts-and-farming).

**INV-057 Follow items as storage moves them.** After a BankBoi run the console retargets stand listings, NPC sale marks, upgrade marks, mail attachments and craft allocations to the items' new pack and slot.

Rules:

- relocated stacks move references from bankboi:<name> by storage identity (inventory/bankboi-completion.ts:49-64)
- a craft deposit resolves its allocation only into an items<N> pack with enough quantity; the job stays blocked until every allocation resolves (bankboi-completion.ts:65-84)
- a mail deposit becomes the mail source and unblocks the mail job (bankboi-completion.ts:85-95)
- a normal deposit rewrites the matching withdrawal (exact JSON match) and moves listing, sale and upgrade references (bankboi-completion.ts:96-126)

Handed over by other specs: 13 functions (13-lifecycle).

**INV-058 Adopt the bank staging row as BankBoi cargo.** While any BankBoi exists, the last seven cells of bank pane 1 are a transfer area; items there become staged store requests unless the merchant is waiting to withdraw them.

Rules:

- staging is reserved only while at least one BankBoi exists (inventory/reserved-cargo.ts:28-31)
- items1 slots 35-41 not reserved for retrieval become store requests, id items1:<slot>:<identity> (reserved-cargo.ts:51-86)
- requests for slots >= 35 drop when staging is no longer reserved, the slot is reserved for retrieval, or the item changed (reserved-cargo.ts:43-49, 88-92)
- the first reconcile with staging reserved marks the migration done; earlier requests carry bootstrap (reserved-cargo.ts:72, 93-97)

Settings:

- bankboiQueue, bankboiReservedMigrated (reserved-cargo.ts:18-19)

**INV-059 Create and delete BankBoi characters.** The console creates numbered merchant storage characters and deletes an empty one after the game's cooldown.

Rules:

- tries prefix + 0, 1, 2 ... up to min(10 000, 10^(12 - prefix length)) names, skipping owned names and name errors (characters/creation.ts:75-95)
- an accepted creation the roster does not confirm stops without trying another name (creation.ts:86-91)

Handed over by other specs: 22 functions (13-lifecycle).

### Stocking

**INV-060 Restock potions and elixirs.** Each character has a restock policy for hp potions, mp potions and an optional elixir; the merchant delivers until the maxima are met and can order elixirs it lacks.

Rules:

- default policy: hp hpot1 min 5 max 20, mp mpot1 min 0 max 0 (inventory/storage-service.ts:62-72)
- a restock counts as done only when inventory is known and each supply with max > 0 reaches max (inventory/restock-completion.ts:21-28)
- an elixir restock is ready when unlocked, unbound stock exists outside BankBoi (and outside the character's own bag when the character is the merchant) (application.ts:519-528)
- with autoAcquire and no stock it orders max(1, max - have) through restockSupply, once per pending order (application.ts:526; http/merchant-order.ts:283-310)
- supply counts sum q per item name (status/merchant-scheduling.ts:88-93)

Settings:

- restockPolicies[name] {hp, mp, elixir {item, min, max, autoConsume, autoAcquire}} (http/restock.ts:29-42)

Handed over by other specs: 6 functions (13-lifecycle).

**INV-061 Count what the merchant can use from all storage.** One view lists the merchant's bag, bank panes and complete BankBoi stacks, minus anything reserved for crafts or deliveries.

Rules:

- locations: inventory:<merchant>, each bank pack, bankboi:<name> (inventory/merchant-storage-stock.ts:7-21)
- a BankBoi stack counts only while untouched by reservations (merchant-storage-stock.ts:19-20)
- delivery reservations take exact slots first, then matching copies, ignoring q, price, rid, b, giveaway (runtime/craft-reservations.ts:45-57)
- craft needs keyed name@level are reserved first at their allocated location, then anywhere (craft-reservations.ts:7-42)
- a protection error hides all stock (craft-reservations.ts:8)
- storagePack accepts a bank pack name or bankboi:<name> (inventory/storage-source.ts:2-6)
- storage identity = JSON [name, level, stat_type] (inventory/storage-service.ts:51-60)

### Item helpers and catalog

**INV-062 Match and count items by fingerprint.** The character finds, counts and re-finds items by comparing a fixed set of item fields, so a mark still matches after the item moves slot.

Rules:

- fingerprint copies 12 fields (name, level, q, p, stat_type, data, price, rid, b, m, l, v) and turns expires into a number (shared.js:1241-1249)
- sameItem compares every wanted field except q as JSON text (shared.js:1251-1255); sameItemState compares whole fingerprints without q (shared.js:1257-1263)
- findMarkedInventoryItem and findMarkedItem prefer the marked slot, then the first matching slot (shared.js:1292-1299, 3820-3823)
- waitForMarkedItem polls every 50 ms for up to 2000 ms (shared.js:3825-3833)
- itemAvailability counts carried and banked copies; the bank count is zero away from the bank (shared.js:1321-1334)
- inventoryTotals, inventoryQuantity, itemQuantity and inventoryAmount count by name or match with q defaulting to 1 (shared.js:922-927, 1315-1319, 5487-5495)
- freeInventorySlots counts empty slots up to character.isize (shared.js:5398-5403)

Handed over by other specs: 1 functions (triage).

**INV-063 Build the item catalog and per-item details.** The character builds the dashboard's item catalog (buyable, craftable, exchangeable, every item's details, drop sources and suggested prices) from game data.

Rules:

- itemDefinition sends only per-copy fields (properties, title, skin sprite) once the coordinator acknowledged the catalog (catalogKnown), otherwise the full definition (shared.js:1756-1786)
- maximumItemLevel returns 7 for compound items and 13 for upgrade items (shared.js:1397-1399); see problem 'Max item levels disagree with the game'
- itemDropSources merges monster, home, Cipher-window, map and Tracktrix world drop tables, sorted by threat then rate, cached per item (shared.js:1480-1589)
- itemSuggestedPrices prices an item at max(definition g, ceil(kills x gold / quantity)) with kills for 90% drop certainty (log 0.1) per farmable monster and map (shared.js:1610-1664)
- merchantCatalog lists buyable items (seller, g >= 0, not cash), recipes, exchangeables at levels 0-13 and token rewards, and carries a copied upgrade chance table for igrade 0-2 (shared.js:2234-2310); the table matches the game's design/upgrades.js:1-44
- itemSeller returns the first non-ignored NPC that stocks the item (shared.js:3835-3841)

Handed over by other specs: 4 functions (04-targeting).

**INV-064 Report inventory, equipment and bank in status.** The character attaches its inventory, equipped slots and bank to status reports, and skips the full copy when the coordinator already holds the same revision.

Rules:

- statusInventory caches on JSON of items, slots, bank and the active upgrade; the cache key is used only after catalog acknowledgement (shared.js:3195-3209)
- attachStatusInventory resends the full inventory at least every 10 s even when the revision is acknowledged (shared.js:3210-3217)
- acknowledgeStatusInventory ignores combat-only reports (shared.js:3226-3230)
- bankSnapshot always reports 42 slots per unlocked pack (shared.js:1902-1915)
- inventoryOperationEntry shows a pending upgrade or compound placeholder as the real item with from and to level and chance (shared.js:4555-4569)
- bankVaultCatalog lists packs with floor, gold and shell cost and the key that unlocks each floor (shared.js:1926-1943)

### Bank primitives

**INV-065 Deposit an inventory slot fully.** The character deposits one inventory slot into the bank, merging into a matching stack first, honouring protected locations and the BankBoi staging pane.

Rules:

- bankStoreFully tries up to 50 deposits per slot (shared.js:4070-4071)
- an item in a slot past isize is first swapped into a valid empty slot with a 2500 ms wait (shared.js:4073-4084)
- it fills existing stacks through the stack service, then uses only locations the coordinator allows (bankStackService().locations) on the current floor (shared.js:4085-4105)
- with bankStaging on, items1 slots 35-41 are a transfer pane: they take merges and, as a last resort, new deposits (shared.js:344, 4106-4128)
- a stack whose bankStackHomes owner is another character is not placed in a new slot (virtual home) (shared.js:4116-4118)
- with no destination it asks the BankBoi checkpoint, then throws 'bank_full' (shared.js:4129-4132); completion-retries.ts:136 matches /^(bank_full|inventory_full|no_space)$/
- after bank_store it waits up to 2500 ms for the slot to change because the promise can resolve before the inventory proxy updates (shared.js:4140-4148)
- bankboiCheckpoint (merchant only) POSTs /bankboi/checkpoint with the bank snapshot and throws 'bankboi_pending' when storage wants the merchant slot (shared.js:4153-4161); completion-retries.ts:41 matches that text
- bankStackIdentity keys a stack on 9 fields with level as a number (shared.js:4019-4023)
- waitForBankPack polls 100 ms for up to 10000 ms by default and throws 'bank data did not load' (shared.js:1917-1924)

Settings:

- bankStaging (character var, default true because older coordinators omit the flag) shared.js:342-344

Handed over by other specs: 2 functions (02-movement).

**INV-066 Compact bank stacks once per visit.** The character merges partial bank stacks through the shared stack library, at most once per bank visit signature, and journals its buffer slots.

Rules:

- bankStackService wraps root.partyCreateBankStacks with ports for items, bank, isize, floor of a pack, reachable floors, stack limit (G.items s), movement and the bank calls (shared.js:4026-4057)
- protection reads POST /merchant/bank-sort/checkpoint action 'stack' and throws 'Bank stack protection unavailable; coordinator update required' without it (shared.js:4035-4039; merchant/bank-sort.ts:98-106)
- the stack journal lives in localStorage 'party-bank-stack-buffer:<name>'; root.__partyBankStackJournal overrides it because caracAL echoes stale writes (shared.js:4045-4054)
- finishBankStacks skips a repeat when [bankStaging, visit id, bank] is unchanged, posts /status after moves, and reports a deferral when buffers are unavailable (shared.js:4058-4068)
- normalBankStackFits and mergeIntoNormalBank find and fill a partial normal-bank stack outside staging (shared.js:4571-4585)

Handed over by other specs: 1 functions (02-movement).

**INV-067 Withdraw or stage with confirmation.** The character withdraws a bank slot or deposits into an exact bank slot and waits until the game shows the move.

Rules:

- bankRetrieveConfirmed waits for consoleAtomicBoundary, raises root.__partyConsoleAtomic, then polls 100 ms up to 5000 ms until the bank cell is empty and the carried count grew by the stack's q, else throws 'Bank withdrawal was not confirmed' (shared.js:4587-4607)
- bankStageConfirmed refuses an occupied target, then polls up to 5000 ms for the exact identity and quantity in the target cell (shared.js:4609-4624)
- retrieveFromBankUntil calls bank_retrieve up to 100 times with no settle wait between calls (shared.js:1336-1345)

**INV-068 Merchant bank errands on every visit.** Each merchant bank visit deposits gold above target, takes queued withdrawals, banks marked items and fetches bank items marked for NPC sale.

Rules:

- merchantVisitBank closes the stand, walks to the bank, waits for items0, checks BankBoi before and after errands, then sorts the floor (shared.js:6051-6066)
- errands run once per command (_merchantBankErrandsChecked) (shared.js:5922-5926)
- withdrawals stop at 3 or fewer free slots; self improve records the deferred ones (shared.js:5950-5959)
- a withdrawal missing from the bank is acknowledged as stale (shared.js:5963-5971)
- marked items that feed this job's upgrades, compounds, auto compounds or bank upgrade rules stay carried (shared.js:5980-5993)
- each bank mark asks a protection checkpoint and keeps partly reserved stacks (shared.js:5927-5941, 6003-6006)
- 'bank_full' defers the deposit and continues (shared.js:6008-6015)
- NPC sale withdrawals stop at esize <= 3 and call bank_retrieve with no settle wait (shared.js:6019-6032)
- withdrawMerchantCash withdraws max(shortfall, cash target minus carried gold), capped by bank gold (shared.js:5911-5919)

Settings:

- merchantGoldTarget (status setting, default 0) read shared.js:11340, 5912-5913

### Bank sort

**INV-069 Sort the bank floor the merchant stands on.** While at the bank, the merchant reorders each pack on the current floor by category, value, name and level, one swap at a time through one free inventory slot.

Rules:

- smart_move is rebound to bankSortMove for the whole file (shared.js:32); leaving a bank floor first recovers stacks, cleans sort buffers, compacts stacks and runs a requested sort, and refuses to leave with 'Bank sort buffer cleanup pending; staying in bank' while a buffer holds an item (shared.js:4305-4327)
- bankSortAuthorization: mode 'automatic' sorts when no requested pass runs; mode 'request' sorts only for the claimed pending id, runtime and visit (shared.js:4180-4185)
- sortCurrentBankFloor skips a floor whose signature is unchanged this visit, needs one free inventory slot, and skips staging slots items1 35-41 (shared.js:4376-4408)
- category order comes from bankSortTypes (helmet ... exchange, other) with offhand, scroll and exchange groupings (shared.js:4329-4346); ties break on gold_value or g, then name, then higher level first (shared.js:4348-4360)
- every swap calls bankSortGuard (one HTTP checkpoint), journals both sides before the native call, and waits up to 5000 ms for both sides to match (shared.js:4418-4439, 4255-4283)
- the loop stops after max(200, 3 x items) operations and throws if any slot is still misplaced (shared.js:4415, 4441, 4449-4456)
- after a sort with moves it posts /status so the dashboard shows the new order (shared.js:4458-4464)
- accessibleBankSortFloors walks bank doors, skipping 'complicated' doors and key doors without the key (shared.js:4192-4211)
- merchantVisitBank sorts on every physical bank visit; commerce and stat-scroll preload sort again after withdrawals (shared.js:6059-6065, 7932, 6601-6607)

Settings:

- bankSortMode (coordinator, default automatic) read through the checkpoint shared.js:4181-4182

Handed over by other specs: 3 functions (02-movement, 05-survival, 07-hunts-and-farming).

**INV-070 Hold a requested bank sort as a lease.** The coordinator keeps a requested bank sort as durable intent that one merchant runtime and bank visit may claim, complete or hand back for retry.

Rules:

- initialBankSort restores mode (default automatic) and turns a saved 'sorting' request into 'retry' with no runtime or visit (merchant/bank-sort.ts:25-31)
- configure accepts mode automatic or request and enabled true or false; enabling creates one queued request with a random id (bank-sort.ts:84-93)
- checkpoint returns 409 unless the runtime id is current; action 'stack' returns staging, all withdrawal locations and craft requirement items as protection (bank-sort.ts:94-106)
- a claim needs a visit entered after the request was made, unless the request is in retry (bank-sort.ts:40-47)
- a different runtime turns a held request into retry with 'Merchant restarted; retry pending' (bank-sort.ts:52-60); reconcile does the same with 'Merchant interrupted; retry on next visit' (bank-sort.ts:76-83)
- retry messages are cut to 300 characters (bank-sort.ts:64-68)

Settings:

- bankSortMode 'automatic' | 'request' (default automatic): read bank-sort.ts:26, 108-110; written bank-sort.ts:87
- bankSortRequest (default null): written bank-sort.ts:63, 88-90

### Fighter bank run and BankBoi

**INV-071 Fighter bank run and potion stock-up.** A fighter walks to the bank to deposit marked items, take withdrawals and set its gold, and buys HP potions when it has none.

Rules:

- stockUp buys hpot1 up to 20 at fancypots only when the character carries none and no BankBoi, stocking, upgrading, banking, bankQueued or departure flag is set, then returns to partyLocation or its origin (shared.js:3788-3818)
- goBank busy-waits on stocking every 250 ms, deposits each marked item fully, takes withdrawals until 3 or fewer free slots remain, skips bankboi: packs, and calls bank_retrieve with no settle wait (shared.js:4467-4486)
- goBank deposits gold above goldTarget or withdraws up to it, then returns and POSTs /bank-complete with what it withdrew (shared.js:4487-4515)
- the role runner reads isBanking (banking or bankQueued), isStocking and isUpgrading (shared.js:17476, 17531-17532)
- the coordinator clears a stale 'bank' command slot for recoverBank (status/scheduling-composition.ts:36-38)

Settings:

- goldTarget per bank command shared.js:4487

**INV-072 Fighter self-upgrade run.** A non-merchant unequips marked gear, buys scrolls and purchases, upgrades and compounds at the upgrade NPC, then returns.

Rules:

- upgradeMarked busy-waits on stocking every 250 ms and sets upgrading (shared.js:3843-3846)
- tiers are capped by maximumItemLevel minus the current level (shared.js:3865-3867)
- scroll need is one scroll per tier at the grade of each level; compound groups need exactly 3 same-level items (shared.js:3870-3899)
- a gold shortfall is withdrawn from the bank; it throws when bank plus carried gold is short (shared.js:3905-3917)
- each tier runs a preview upgrade, then upgradeConfirmed; lucky_slot_unavailable is rethrown, other errors stop that item (shared.js:3938-3957)
- compounds use raw compound() without the confirmed wrapper (shared.js:3972-3975)
- it always returns and POSTs /bank-complete with upgraded, purchased and compounded (shared.js:3983-3997)

**INV-073 BankBoi character storage run.** The BankBoi character unloads into the bank, stages requested items for the merchant in the transfer pane, and deposits retrievals.

Rules:

- provision: it walks to potions, unequips every slot and sells every item back to back with no delay, then deposits all gold (shared.js:4680-4689, 4695)
- after smart_move('bank') it waits up to 10000 ms for items1 because the bank proxy may not be hydrated (shared.js:4690-4694)
- unloadNormalBank stores items except protected and retrieval ones into allowed, unreserved locations, merging first, and records relocations (shared.js:4629-4667)
- stacks whose home belongs to another character go to the first empty staging slot 35-41 (shared.js:4697-4712)
- each request withdraws only the exact staged identity, never a fallback search, and refills a normal bank stack if one fits (shared.js:4713-4737)
- retrievals go to a craft deposit location for craft jobs or a free staging slot (shared.js:4668-4678, 4739-4753)
- it sorts the bank floor only when nothing moved, then sorts its own inventory with unawaited swap() calls 120 ms apart (shared.js:4754-4764)
- it POSTs /bankboi/complete with completed, deposited, relocated, bank, items and slots, or the error (shared.js:4765-4777)
- the coordinator restores the merchant after a BankBoi transaction through bankboiService.restore (application.ts:2449-2453)

### Upgrades and compounds

**INV-074 Journal every merchant upgrade and compound.** The merchant records each upgrade or compound in a local journal and with the coordinator before, during and after the game call, so a restart can tell what happened.

Rules:

- trackedProduction runs non-merchant work directly, refuses while root.__partyProductionWorking or __partyProductionRecovery is set, and holds __partyProductionWorking during the run (shared.js:4962-4968)
- trackedProductionWork recovers the old journal, calls yieldMerchantForEvent, checks craft reservations for automatic work, and writes a 'prepared' journal (shared.js:4969-4981)
- admission POSTs /merchant/production; an already completed attempt returns {alreadyAttempted}; on 409 it inspects and drops the journal only when admission is confirmed absent (shared.js:4982-4998)
- a commerce journal with no live item and no confirmed destruction throws 'Upgrade outcome uncertain; production receipt requires inventory review' (shared.js:5011-5012); completion-retries.ts:113-118 matches /upgrade.*uncertain/
- failures matching /timed out|uncertain|interrupted|recovery/ are rethrown without a receipt (shared.js:5014)
- verifyProductionProtection throws 'Item reserved for crafting; automatic production deferred' when a slot is reserved or locked (shared.js:4953-4961)
- verifyMerchantItemMarks POSTs a protection-only checkpoint for the active job (shared.js:4783-4787)
- rememberCommerceProduction, replayCompletedCommerce and rememberReviewedCommerce copy outcomes into the commerce journal by sequence, and throw 'Reviewed production is still settling' while a placeholder exists (shared.js:4803-4850)
- journal storage and recovery (productionJournalKey, read/write, finish, save, recoverProductionJournal(Work), shared.js:4789-4952) are outside this list; cite only

Handed over by other specs: 5 functions (11-settings).

**INV-075 Confirm an upgrade or compound against inventory.** The merchant fires the native upgrade or compound and decides success, failure or destruction from the inventory, not only from the game promise.

Rules:

- compoundConfirmed and upgradeConfirmed wait for consoleAtomicBoundary and hold root.__partyConsoleAtomic (shared.js:5023-5036)
- upgradeConfirmed sends a scroll whose name is not scroll<digits> (a stat scroll) straight to observedUpgradeConfirmed without a production journal (shared.js:5032-5033)
- observedCompoundConfirmed casts massproduction, does not await compound(), and returns when inventory changed and no compound queue remains (200 ms grace), else times out after 30000 ms (shared.js:5037-5068)
- observedUpgradeConfirmed re-finds the item after the checkpoint, rereads the scroll slot by name, picks luckyUpgradeSlot (0-41) or the tracker's choice, and runs the lucky wrapper (shared.js:5070-5109)
- upgradeAtSlotConfirmed expects the same name at level+1 by default, treats a placeholder as pending, reports a failed survivor as success:false, throws upgrade_destroyed with confirmedDestroyed when the slot empties after a failed result, waits 1500 ms after the operation ends, and times out after 30000 ms (shared.js:5182-5244)
- merchantMassBuff uses <base>pp only when 20% of max MP stays after its cost, else the base skill, and races use_skill against 750 ms (shared.js:5154-5180)

**INV-076 Upgrade in the lucky slot.** The merchant moves an item into its lucky inventory slot for the upgrade roll, journals the swap, and tries to put things back afterwards.

Rules:

- luckySlotTracking keeps a tracker in localStorage 'party-lucky-slot-tracking:<owner>:<character id>' and resets when the character id changes (shared.js:689-705)
- luckySlotRollListener feeds q_data upgrade rolls to the tracker and stamps 'party-upgrade-preview-revision:<name>' (shared.js:706-711)
- merchantLuckyUpgrade wraps root.createPartyLuckyUpgrade with a journal in 'party-lucky-upgrade:<name>' loaded once because caracAL echoes old values (shared.js:5111-5125)
- its checkpoint refuses a layout that does not belong to the active production attempt (shared.js:5126-5134)
- a restore failure only warns 'Lucky slot restoration skipped; leaving items in their current positions' (shared.js:5136-5142)

Settings:

- luckyUpgradeSlot (merchant setting via status, var default null) shared.js:681, 5097

**INV-077 Find upgrade marks and supply offerings.** The merchant locates each upgrade mark's live item and fetches the offering its rule asks for from bank floors or BankBoi.

Rules:

- findUpgradeMarkSlot anchors the target to the original mark level plus tiers capped by maximumItemLevel, follows a unique survivor for passId or requestId marks, and throws 'Upgrade inventory recovery ambiguous:' for several (shared.js:6068-6093); completion-retries.ts:124 matches that prefix
- upgradeOfferingCheckpoint throws 'Offering reservations unavailable; upgrade deferred' without craft protection (shared.js:6095-6099)
- availableOfferingEntries drops reserved, locked and bound items (shared.js:6100-6108)
- upgradeOfferingDemand counts one offering per remaining level whose rule names it, at least 1 (shared.js:6117-6129)
- retrieveUpgradeOffering asks /merchant/offering-supply first, else walks accessible floors withdrawing with a checkpoint after each, else asks BankBoi; a pending supply throws 'bankboi_pending' (shared.js:6130-6165)
- prepareUpgradeOffering records 'wait-offering' and returns {waiting:true} when a required offering is missing (shared.js:6179-6205)
- upgradeRecoverySignature keys an upgrade recovery block on the marks and the matching items only (merchant/upgrade-recovery.ts:5-9)

Handed over by other specs: 1 functions (07-hunts-and-farming).

**INV-078 Run purchases, upgrades, compounds and auto compounds.** The merchant buys requested items, upgrades each mark to its target, compounds marked triples and runs auto compound rules from inventory and bank.

Rules:

- purchases: one unit each from the item's seller, funded from the bank (shared.js:6211-6219)
- each upgrade attempt prepares the offering twice (before and after scroll travel) and stops the mark while it waits (shared.js:6229-6250)
- a missing scroll re-plans only the unfinished work and buys a batch (shared.js:6236-6246)
- a failed survivor retries; upgrade_destroyed stops that mark; any other error stops the job (shared.js:6262-6275)
- compound groups with bank-reserved inputs throw when an input moved (shared.js:6283-6296)
- auto compounds take the highest-level triple first, withdraw at most one triple at a time, stop at the rule quantity per pass, and throw 'Auto compound made no inventory progress' (shared.js:6334-6391)
- retrieveAutoCompoundBatch throws 'inventory_full' when esize is below needed plus one for a missing scroll, and refreshes protection (one HTTP call) before each bank_retrieve (shared.js:6399-6431)
- refreshCompoundProtection rewrites command.autoCompounds from the live rules mid-job (shared.js:6433-6445)

**INV-079 Supply upgrade and compound scrolls.** Before improving, the merchant takes scrolls from the bank and buys the rest in one trip.

Rules:

- manualImprovementScrollNeeds batches only steps at the starting grade, stages one scroll of each later grade, and one compound scroll per grade (shared.js:6468-6509)
- prepareManualImprovementScrolls visits the bank only when carried stock is short, retrieves with retrieveFromBankUntil, withdraws gold, then buys at the scrolls NPC (shared.js:6530-6561)
- ensureOwnedItemQuantity does the same for one item and throws 'Insufficient bank gold for ...' (shared.js:6511-6528)

**INV-080 Apply stat scrolls.** The merchant applies stat scrolls to its own items, delivers scrolls to a fighter, or a fighter applies delivered scrolls to its equipped gear at the shrine.

Rules:

- statScrollQuantity uses 1, 10, 100, 1000 scrolls for grades 0-3 (shared.js:6563-6565), matching the game's needed table (game server.js:7466)
- applyStatScrolls needs the exact clicked item state, calls raw upgrade(), and waits 2500 ms for stat_type (shared.js:6618-6664)
- deliverStatScrolls subtracts the target's carried scrolls, meets the target and sends the rest (shared.js:6666-6688)
- applyOwnedStatScrolls travels fully equipped, unequips one piece at a time, applies via upgradeConfirmed, re-equips, then returns to the leader or its origin and equips delivered items (shared.js:6690-6752)

Handed over by other specs: 1 functions (11-settings).

**INV-081 Merchant self improve job.** The merchant runs its own improvement pipeline: drop stale stat requests, unequip marked gear, gather bank inputs, buy supplies, improve, store compound leftovers, and re-equip.

Rules:

- stale stat-scroll requests are removed before any gold is withdrawn (shared.js:7295-7309)
- equipped upgrade and stat marks are unequipped back to back (shared.js:7310-7322)
- prepareBankCompounds withdraws reserved bank triples and confirms each within 2500 ms (shared.js:7208-7229)
- prepareBankUpgrades reserves at most 3 bank items for auto upgrade rules, stops at esize <= 3, and checks each withdrawal with no settle wait (shared.js:7231-7270)
- leftover compound inputs go back through partyStoreCompoundLeftovers (shared.js:7331-7347)
- re-equip falls back to the highest-level item of the same name (shared.js:7275-7293)
- deferred withdrawals throw 'inventory_full' after the work (shared.js:7362-7364)
- failure restores only upgrade marks and reports 'bankboi_pending' as a pause (shared.js:7379-7398)

### Commerce orders

**INV-082 Buy and level items (version 2 engine).** For commerceProgressVersion 2 orders, the merchant buys base items in batches and levels each one, saving a durable cycle state after every step.

Rules:

- merchantBuyUpgradeLine resumes the saved line or starts a new one; an unavailable estimate needs a positive goldCap as budget (shared.js:7447-7458)
- legacy checkpoints without results rebuild them from inventory and throw on a count mismatch (shared.js:7464-7470)
- every owned group is remapped after inventory moves; a count mismatch throws 'Owned upgrade item is ambiguous' or '... missing' (shared.js:7416-7445, 7479)
- batch size is buyUpgradeBatchSize clamped 1-42, minus 3 free slots and one for a missing scroll, cut until it fits the budget (shared.js:7645-7661)
- each purchase is journaled as pendingPurchase before buying; spend over budget throws '90% estimated budget exhausted' (shared.js:7528-7541)
- settleUpgrade throws 'Commerce production is still settling' while a placeholder exists, records destruction or an operator review, and adopts an intermediate-level survivor (shared.js:7542-7607)
- the attempt limit defaults to 10000 when the order has none (shared.js:7640-7642)

Settings:

- buyUpgradeBatchSize (default 1, range 1-42) written http/thresholds.ts:34, read shared.js:7645

**INV-083 Run a shopping, crafting and leveling order.** The merchant collects materials from party members, withdraws and buys what an order needs, buys and levels items, crafts recipes, and reports progress.

Rules:

- version 2 orders take the newer of localStorage 'party-commerce:<id>' and the coordinator resumeState by sequence (shared.js:7722-7727)
- each checkpoint bumps the sequence, saves locally, POSTs /merchant/checkpoint and throws 'merchant_yield' when the coordinator says yield (shared.js:7754-7776)
- material handoffs poll /merchant/job every 750 ms for up to 90000 ms (shared.js:7796-7802)
- bank materials are withdrawn into an empty slot and split to the exact quantity with a fixed 250 ms wait (shared.js:7851-7874)
- saved scrolls are withdrawn whole with no settle wait between calls (shared.js:7918-7924)
- materials at level 0 with a seller are bought; others throw 'Crafting material is unavailable' (shared.js:7943-7950)
- the legacy engine (not version 2) buys and levels one item at a time with a 10000 attempt safety limit and a compound branch (shared.js:8046-8165)
- crafts visit recipe.quest's NPC or craftsman and checkpoint after each auto_craft (shared.js:8167-8202)
- failures with hunt_movement_owned, commerce movement, any version 2 error, or 'interrupted|merchant_anniversary_reserved|bankboi_pending' report as paused with failureKind (shared.js:8210-8224)
- commerceMove (shared.js:7738-7753) is not in this list; cite only

Handed over by other specs: 1 functions (02-movement).

**INV-084 Validate orders and allocate craft materials.** The coordinator checks order lines and spreads each recipe's material need over merchant inventory, bank, BankBoi and party inventories.

Rules:

- normalizeOrderLines accepts at most 100 lines, quantity 1-9999, a positive safe gold cap, and a level only up to highestUpgradeLevel on upgradeable items (merchant/order-validation.ts:5-58)
- allocateOrderMaterials totals materials per id@level and takes from each source in call order, recording bankboi:, bank, party or merchant allocations (merchant/order-materials.ts:10-71)
- estimateUpgradeBatch yields through node setImmediate because the caracAL sandbox lacks it (merchant/upgrade-estimate.ts:4-8); estimateUpgrade has no production caller (review 1.1: tests only)

**INV-085 Reserve craft and commerce stock.** The coordinator derives which items are reserved for queued crafts, deliveries and running buy-and-level batches, so other jobs leave them alone.

Rules:

- craftProtection walks the current job and queue in queuedAt order, once per job id, and returns the error text instead of throwing (merchant/craft-reservations.ts:47-65)
- a recipe missing from the catalog fails the whole protection with 'Cannot protect crafting ingredients: recipe missing for ...' (craft-reservations.ts:41-42)
- orders in leveling or crafting phase reserve their needs in merchant inventory (craft-reservations.ts:16-18)
- deliveries and version 2 commerce results, batch items, the active item, its pending level and a pending base purchase are protected (craft-reservations.ts:67-96)
- a pending purchase reserves before plus quantity (craft-reservations.ts:98-102)

**INV-086 Exchange items and tokens.** The merchant withdraws exchange materials, exchanges them at the right NPC or buys token rewards, reports each step, and banks rewards the rules route to the bank.

Rules:

- lines merge by id, level and reward; their materials are removed from bank marks (shared.js:8253-8269)
- each withdrawal waits up to 2500 ms; a shortage asks /merchant/exchange-supply and throws 'bankboi_pending' or 'Not enough ...' (shared.js:8316-8337)
- token rewards use raw parent.push_deferred plus parent.socket.emit('exchange_buy', {num, name, q}) on the verified stack (shared.js:8356-8361); the game uses q only as a safety check (game server.js:6626-6650)
- item exchanges split the exact quantity with a fixed 250 ms wait, cast massexchange and verify marks (shared.js:8278-8290, 8362-8366)
- exchangeGains counts new or grown slots because a stackable reward merges into a carried stack (#28) (shared.js:8241-8250)
- planAutoExchanges builds lines from auto exchange rules and unlocked stock divided by the required count (merchant/automatic-improvements.ts:56-85)
- the scheduler queues one 'exchange' job when no exchange is current or queued and no production is pending (merchant/improvement-scheduler.ts:161-186)

Settings:

- merchantAutomations['automatic exchange'] (default on) improvement-scheduler.ts:163
- autoExchanges rules improvement-scheduler.ts:89

Handed over by other specs: 1 functions (02-movement).

### Market purchases

**INV-087 Read Ponty and buy from him.** The merchant reads Ponty's secondhand stock in the background and buys planned listings, hopping realms per listing and home afterwards.

Rules:

- refreshPontyListings reads get_secondhands, prices each listing at round(calculate_item_value x 2, or x 3 for cash items) and tags it with the current server (shared.js:1265-1290); the game charges value x mult x q (game server.js:8346-8350)
- merchantPontyBuy hops to each listing's realm, funds from the bank, rereads Ponty, and requires the same properties and quantity and no price rise (shared.js:8605-8636)
- it keeps the 3-slot reserve and buys through guardedMarketPurchase (shared.js:8645-8648)
- bank gold shortfalls stop the job; other failures report per listing via /merchant/ponty-progress (shared.js:8651-8658)
- it returns to aldataHomeRealm and refreshes Ponty (shared.js:8660-8661)
- the dispatcher plans Ponty listings against the merchant's current server once per job (merchant/dispatcher.ts:181-194)
- currentRealm and changeRealm inside the executors belong to spec 09

**INV-088 Authenticate with ALData.** The merchant mails its ALData key to earthiverse; the coordinator marks auth YES and confirms it 65 s later.

Rules:

- merchantALDataAuth needs 50000 gold on hand (the game charges 48000 for a mail without item, game logic/mail.js:143) and sends 'aldata_auth' mail with a 20000 ms timeout (shared.js:8677-8704)
- authenticate marks YES on a successful 'ALData authentication' job and schedules confirmAuth after 65000 ms (merchant/completion.ts:30-38)
- confirmAuth stores the server's auth value and publishes on CORRECT (completion.ts:17-29)

**INV-089 Buy ALData marketplace listings.** The merchant visits player sellers found through ALData, across realms, and buys listings at or below the advertised price.

Rules:

- it funds the whole itinerary only on the home realm, then per listing (shared.js:8836-8857)
- marketplaceMove races smart_move against 45000 ms and stops both movement kinds on timeout (shared.js:8774-8798)
- it waits up to 60000 ms for the seller, refreshes the location once, and follows with xmove every 1000 ms beyond 300 px (shared.js:8865-8892)
- a listing matches on name, level, p, not a buy order, and price <= advertised (shared.js:8807-8824)
- failure codes are seller_not_visible, stand_not_open, listing_not_available, inventory_reserve (shared.js:8893-8906)
- /merchant/aldata-progress can add listings or cancel a seller (shared.js:8912-8926)
- batchMarketplaceVisits merges queued ALData orders for sellers already on the itinerary and sorts by seller then price (merchant/marketplace-batch.ts:16-42; dispatcher.ts:145-162)

**INV-090 Sell to an ALData buy order.** The merchant gathers matching items, travels to a buyer's want-to-buy listing and sells into it.

Rules:

- it withdraws matching bank items up to 100 times with no settle wait and no free-slot check (shared.js:8980-8988)
- travel and trade_sell are bounded by 60000 ms and 15000 ms through anniversaryWithTimeout (shared.js:8992-9014)
- a live buy slot must match name, level and p, be a buy order and pay at least the order price (shared.js:8957-8968)

**INV-091 Search and buy from player stands.** The merchant lists nearby player stand offers for an item and buys selected listings after rechecking each one.

Rules:

- nearbyStandListings and merchantStandSearch read trade slots of other characters' open stands, skip buy orders, giveaways and prices below 1, and sort by price (shared.js:2312-2328, 8490-8523)
- merchantStandSearch waits 1200 ms after reaching the market (shared.js:8494)
- merchantStandBuy funds the total, rechecks rid, name and price, keeps the 3-slot reserve and buys through guardedMarketPurchase with trade_buy (shared.js:8525-8565)

**INV-092 Keep native want-to-buy offers and guard purchases.** The merchant mirrors the coordinator's want-to-buy offers on its stand, counts purchase receipts from the socket, and asks permission before each market purchase.

Rules:

- a 'ui' socket listener stored on parent counts '+$$' receipts per offer token when slot, item, level and price match (shared.js:9320-9331)
- nativeStandSync serialises reconciles (shared.js:9339-9344)
- reconcileNativeStand reports slots, stand state, gold and 'space' as more than 3 empty slots; with suspend it opens the stand and waits 250 ms (shared.js:9345-9368)
- removals unequip one offer and wait up to 3000 ms (30 x 100 ms) each; creations place at most 16 wishlist offers, each confirmed within 3000 ms (shared.js:9369-9390)
- guardedMarketPurchase syncs the stand, asks /merchant/native-stand action 'purchase' for an allowed quantity, buys, then flushes the receipt (shared.js:9393-9406)
- saved stand bids restore with useStandSlot false and acceptHigherLevels true (initial-state.ts:126-129)

Settings:

- standBids (per item; useStandSlot default false, acceptHigherLevels default true) initial-state.ts:126-129

**INV-093 Buy from an NPC and keep the logistics reserve.** The character buys from an NPC and waits until the items arrive; market purchases first check that 3 inventory slots stay free.

Rules:

- buyConfirmed buys equipment one unit per request (non-stackables recurse) and stackables in one request (shared.js:4524-4531)
- it polls 100 ms for up to 15000 ms until the count grew by the amount, with a 150 ms grace after the promise settles, else throws 'Purchase did not arrive: <n> x <name>' (shared.js:4532-4553)
- purchasePreservesLogisticsReserve fills matching partial stacks first, then needs free slots minus new slots >= 3 (shared.js:5405-5414); stand, Ponty and ALData buys throw 'purchase deferred: three merchant logistics slots are reserved' otherwise (shared.js:8546-8547, 8645-8646, 8903-8906)

Handed over by other specs: 2 functions (triage).

### Sales

**INV-094 Sell marked items to an NPC.** The merchant sells each NPC-sale mark at fancypots, fetching bank-sourced marks first, and reports resolved and blocked marks.

Rules:

- bank-sourced marks are withdrawn with bank_retrieve and looked up at once with no settle wait (shared.js:9239-9248)
- locked items, changed items and reserved slots are blocked (shared.js:9249-9267)
- the job throws 'interrupted' when it is no longer the active job (shared.js:9263)
- it sells min(mark quantity, stack q) (shared.js:9255, 9262, 9268)

**INV-095 Reconcile NPC sale marks.** The coordinator keeps NPC sale marks matched to the merchant's inventory, blocks missing or locked ones, drops stale automatic ones and retries failures with backoff.

Rules:

- reconcileNpcSales signs the inventory and rebuilds marks; marks become 'running' while a sale runs (merchant/npc-sales.ts:78-121)
- a missing item blocks with 'Marked item is not in merchant inventory'; an automatic mark blocked that way for 300000 ms is dropped by matching the text (npc-sales.ts:36-51)
- identity ignores the lock flag (npc-sales.ts:23-24)
- failNpcSales retries after 5000, 15000, 30000, then 60000 ms (npc-sales.ts:123-135)
- #116 keep rules sell only spare copies: held minus keep minus marked minus withdrawing (merchant/npc-sale-keep.ts:13-30)
- keptNpcSaleCopies flags carried kept copies for banking once nothing is left to sell (npc-sale-keep.ts:37-49)

**INV-096 Collect party members' NPC sale items.** The coordinator marks party members' items for NPC sale under automatic rules, reserves them, and turns them into merchant marks when they arrive.

Rules:

- npcSaleRuleKey is the item key, or [character, key] without shared merchant rules (merchant/player-npc-sales.ts:13-16)
- playerSaleReserved blocks slots with other marks, upgrades, stat scrolls, compounds or deconstruction (player-npc-sales.ts:29-41)
- a new automatic mark is skipped within 10000 ms of a received copy (player-npc-sales.ts:90-105)
- missing, protected, locked, bound or reserved items block with one text (player-npc-sales.ts:129-158)
- receipts move the mark to the merchant with the received quantity (player-npc-sales.ts:61-83)
- collection queues 'marked items' for automatic and 'npc sale pickup' for manual marks (player-npc-sales.ts:160-178)

Settings:

- merchantAutomations['auto npc sales'] (default on) player-npc-sales.ts:159
- autoNpcSales rules (item, character, keep) player-npc-sales.ts:180

Handed over by other specs: 13 functions (13-lifecycle).

**INV-097 Mark merchant stock for automatic sale.** On each merchant status report the coordinator marks carried items for NPC sale or stand listing by rule, clamps keep rules, and queues sale or bank trips.

Rules:

- reconcile sends party members to reconcilePlayerSales and the merchant to reconcileMerchant (merchant/automatic-sales.ts:302-316)
- reconcileMerchant clamps automatic NPC marks to held minus keep minus manual marks unless a sale runs (automatic-sales.ts:263-287)
- markInventory resumes paused stand sales first, then marks NPC sales for autoNpcSales keys and stand listings for autoStandMarks keys, skipping locked items, deconstruction marks and rule conflicts (automatic-sales.ts:211-226)
- queueSales queues 'npc sales' or 'auto npc sales' when a runnable mark exists and none is queued or running (automatic-sales.ts:228-236)
- conflicting automatic rules block a mark with 'Conflicting automatic rules; choose an action in merchant settings' (automatic-sales.ts:240-242)
- carried kept copies queue 'manual bank exchange' at most every 600000 ms (automatic-sales.ts:248-262)

Settings:

- merchantAutomations['auto npc sales'] automatic-sales.ts:207, 231
- autoNpcSales and autoStandMarks (price >= 1) automatic-sales.ts:91-92, 221

Handed over by other specs: 11 functions (13-lifecycle).

**INV-098 Mark bank stock for automatic sale.** While the merchant is idle, the coordinator marks unreserved whole bank stacks for NPC sale withdrawal or stand listing and queues a bank trip.

Rules:

- bank stock is marked only when a merchant exists and no job is current (automatic-sales.ts:162-164)
- partly reserved stacks are skipped because withdrawals move whole stacks (automatic-sales.ts:165-172)
- NPC sale withdrawals per pass are capped at max(10, itemCollectionThreshold) (automatic-sales.ts:135-138, 148)
- a bank stand listing adds a withdrawal tagged standListingId and queues 'manual bank exchange' (automatic-sales.ts:152-158, 292-293)
- queueBankTrip queues 'withdrawals' or 'bank collection' from bankCollectionReason (automatic-sales.ts:258-262)

Settings:

- itemCollectionThreshold (default 10) automatic-sales.ts:138

**INV-099 Plan and reconcile stand listings.** The coordinator keeps the merchant's planned stand listings, caps them at 16 slots including stand bids, reprices all copies of an item, and reconciles them against the live stand.

Rules:

- standReserved and resumeDisplacedSales count non-paused listings plus bids that use a stand slot against 16 (automatic-sales.ts:85-89, 182-201)
- markStandSale skips an item already listed or a paused copy (automatic-sales.ts:90-115)
- markAll reprices every listing of the item identity, then adds sources from inventory and bank until 16 are occupied (merchant/stand-marks.ts:87-113)
- stand identity drops q, price, rid, b and giveaway (stand-marks.ts:27-35)
- single replaces or adds one listing unless the stand is full (stand-marks.ts:143-159)
- bank-sourced listings add a matching withdrawal (stand-marks.ts:46-52)
- createStandReconciliation marks listings live, waiting (inventory or bank) or removes them with a log, and adds withdrawals for waiting bank listings (merchant/stand-reconciliation.ts:30-89)
- activeStandSales drops paused listings (stand-reconciliation.ts:93-95)
- merchantIdle (spec 08) applies the plan: it unequips every non-matching trade1-trade16 listing back to back (shared.js:9537-9550)

Settings:

- autoStandMarks per item price automatic-sales.ts:91
- standBids useStandSlot automatic-sales.ts:88, stand-marks.ts:44

Handed over by other specs: 8 functions (13-lifecycle).

**INV-100 Decide when marked bank items need a trip.** The coordinator counts plain bank withdrawal marks and picks the 'withdrawals' or 'bank collection' routine.

Rules:

- markedBankSlots counts distinct pack:slot cells of plain withdrawals, skipping auto NPC withdrawals while auto NPC sales are off (merchant/bank-collection.ts:13-22)
- plain means not bankboi: and none of improvement, standListingId, deconstructionId, craftJobId, mailJobId (merchant/marked-withdrawals.ts:4-11)
- 'withdrawals' runs whenever that automation is on; otherwise 'bank collection' needs party collection on and at least itemCollectionThreshold cells (bank-collection.ts:24-30)

Settings:

- merchantAutomations.withdrawals and merchantAutomations['party collection'] (default on), itemCollectionThreshold (default 10) bank-collection.ts:27-28

### Deconstruction

**INV-101 Deconstruct marked items.** The coordinator marks items (carried, party, bank or BankBoi) for deconstruction, collects them to the merchant, and the merchant dismantles each unit with a claim and a receipt.

Rules:

- deconstructable needs a dismantle recipe or a compound item above level 0, not locked or bound; boosters are excluded (merchant/deconstruction.ts:51-68)
- marks left running at startup become blocked 'Interrupted action: verify inventory before retrying' so a lost acknowledgement never replays (deconstruction.ts:93-98)
- automatic marks are not recreated within 10000 ms of the last mark update (deconstruction.ts:159-166)
- a missing item waits 10000 ms for merged stacks, then blocks; an automatic mark recovers when the item reappears by matching the block text (deconstruction.ts:176-178, 196-200, 219-227)
- complete marks are kept 60000 ms (deconstruction.ts:233-235)
- bank marks start as 'withdrawing' with a withdrawal and queue BankBoi or 'manual bank exchange'; automatic bank marks skip a cell touched in the last 60000 ms (merchant/bank-deconstruction.ts:48-77)
- withdrawal receipts make the mark ready, or block it when the bank item is missing (bank-deconstruction.ts:78-91)
- each unit claims via /deconstruction/step, checks gold and free space (compound: min(50000000, value x 10) gold and 2 slots, matching the game's dismantle handler), dismantles with a 10000 ms bound and posts a receipt (shared.js:9171-9226)
- a failed unit blocks the mark and stops that mark (shared.js:9213-9216; deconstruction.ts:326-340)

Settings:

- autoDeconstruction rules per rule owner deconstruction.ts:143, 302-321

### Automatic improvements

**INV-102 Schedule automatic compounds.** The coordinator checks compound rules against inventory, bank and BankBoi stock, stages missing inputs from BankBoi, and queues 'auto compound' or a pickup.

Rules:

- evaluateAutoCompounds sets runnable when some level below target has 3 unlocked copies; it never fills completed and keeps every rule (merchant/automatic-improvements.ts:29-54)
- nothing is scheduled while a production attempt is pending (improvement-scheduler.ts:130-133)
- sharedCompoundRules merges rules by name@tier, -1 meaning unlimited, sorted by tier (merchant/banked-improvements.ts:20-32)
- stageCompound plans BankBoi inputs only when no job, BankBoi transaction or withdrawal is pending and the merchant has more than 3 free slots (improvement-scheduler.ts:55-58, 77-85, 125-126)
- planCompoundStorage stages only the missing inputs of the highest available triple of the first rule (merchant/compound-storage.ts:13-30)
- the merchant is runnable on carried triples, local triples when inputs fit, or compound leftovers (improvement-scheduler.ts:127-128); another member queues 'marked items' when it has an automatic pickup (improvement-scheduler.ts:148-150)
- pruneCompound drops a queued 'auto compound' when nothing is runnable (improvement-scheduler.ts:154-159)

Settings:

- merchantAutomations['auto compound'] (default on) improvement-scheduler.ts:138
- autoCompounds rules (name, targetTier, quantity) improvement-scheduler.ts:73

**INV-103 Schedule automatic upgrades from storage.** The coordinator matches auto upgrade rules to protected storage stock, stages BankBoi copies, and queues 'auto upgrade' when the normal bank holds a candidate.

Rules:

- parseUpgrade reads 'name@+L' keys with tiers >= 1 and L + tiers <= 13 (merchant/banked-improvements.ts:33-37)
- sharedUpgradeRules merges by key and tiers, sorted by final level (banked-improvements.ts:38-47)
- a rule is runnable with quantity -1 or above 0, no rule conflict, no mark waiting for an offering, and a matching unlocked stack (banked-improvements.ts:59-65, 90-95)
- planUpgradeStorage stages the first BankBoi copy for a rule with no local copy (banked-improvements.ts:71-84)
- bankUpgrades runs only for the merchant with auto upgrade on (improvement-scheduler.ts:97-106)
- completedUpgrades has no production caller (banked-improvements.ts:56-58; review 1.1)

Settings:

- merchantAutomations['auto upgrade'] (default on) improvement-scheduler.ts:98
- autoUpgradeMarks 'name@+L' -> tiers or {tiers, quantity} banked-improvements.ts:40

### Upgrade preview

**INV-104 Preview upgrade chances.** On request, the merchant borrows scrolls and offerings, asks the game for the chance of each option without upgrading, returns the supplies, and the coordinator caches the result.

Rules:

- the coordinator accepts slot 0-41 of an unequipped merchant item, dedupes by [executor, slot, item], returns the cache unless refresh is true, and queues an 'upgrade preview' job (merchant/upgrade-preview.ts:19-38, 73-78)
- a cached result counts only while its revision equals the merchant's upgradePreviewRevision (upgrade-preview.ts:79-84)
- results must match the job, session and every option, and at most 100 are kept (upgrade-preview.ts:49-58, 85-97)
- the character refuses while dead, while any q exists or upgrade deferreds pend, or when the item changed (shared.js:2554-2557)
- it borrows scroll<grade>, offeringp, offering and offeringx from the bank, journaled in 'party-preview-supplies:<name>', and returns them after the preview (shared.js:2496-2546, 2582)
- root.__partyUpgradePreviewInFlight holds ownership until the game's upgrade promise settles (shared.js:2562-2572)

Settings:

- upgradePreviewResults (cap 100) upgrade-preview.ts:18, 53-55

Handed over by other specs: 1 functions (02-movement).

### Other merchant jobs

**INV-105 Donate gold at the XP frog.** The merchant withdraws and donates a chosen amount of gold at lostandfound, and the character tracks the current XP-per-gold rate.

Rules:

- merchantDonate requires a positive amount, funds from the bank, emits raw parent.socket.emit('lostandfound','info'), waits 350 ms, then calls donate_gold (shared.js:9285-9318)
- donationRateListener sets 4.8 below 500000000 server gold, 4 below 1000000000, else 3.2 (shared.js:874-877); the game gives 4 up to and including 1000000000 (game server.js donate handler 'S.gold <= 1000000000')

**INV-106 Send mail with or without an attachment.** The merchant sends a text mail, or fetches the attachment (from inventory or a bank slot), splits the quantity, moves it to slot 0 and mails it.

Rules:

- bank attachments are withdrawn with a fixed 250 ms wait (shared.js:10338-10347)
- a partial quantity needs one free slot and a split with a fixed 250 ms wait (shared.js:10352-10362)
- the attachment is swapped into slot 0 with a 250 ms wait and verified (shared.js:10363-10365)
- send_mail has a 20000 ms timeout; there is no gold check before sending (shared.js:10330, 10366)

**INV-107 Restock the merchant's potions and elixir.** The merchant tops up its configured elixir from the bank and buys HP and MP potions up to their maximums.

Rules:

- restockElixirEntries withdraws unreserved whole bank stacks with a protection checkpoint after each (shared.js:9057-9074)
- merchantSelfRestock funds the total potion cost from the bank and buys each potion at its seller (shared.js:9076-9122)

Settings:

- restock.hp, restock.mp, restock.elixir (item, max) per command shared.js:9079-9084

**INV-108 Set the merchant's carried gold.** The merchant visits the bank and deposits or withdraws gold to reach a target.

Rules:

- merchantSelfBank deposits above goldTarget or withdraws the missing amount capped by bank gold (shared.js:9031-9055)

Settings:

- goldTarget per command shared.js:9032

**INV-109 Unlock a bank floor or vault.** The merchant activates a bank key (from inventory or bank) and enters the floor, or buys a vault pack with gold.

Rules:

- a key is retrieved with retrieveFromBankUntil, activated, then the merchant walks to the pack's NPC (shared.js:9127-9141)
- a vault purchase throws when the pack is already unlocked or gold is short, then calls open_bank_pack(pack, 'gold') (shared.js:9142-9157)

**INV-110 Merge stacks and pin the Tracktrix.** While idle, the merchant merges two matching inventory stacks when the coordinator permits, and keeps a personal tracker in the last slot.

Rules:

- consolidateMerchantInventory skips while a job, anniversary, banking, gathering or anniversary reservation is active, and retries no sooner than 10000 ms (shared.js:9408-9418, 9431)
- it asks /merchant/stack-merge-permission and checks identity, quantities, lock, bound, v flags, stack limit and can_stack before swap (shared.js:9419-9430)
- the swap is bounded by 2000 ms and confirmed within 1500 ms (shared.js:9433-9443)
- keepTracktrixLast checks 13 conditions (inventory commands, banking, bankQueued, upgrading, stocking, anniversary, gathering, active job, tidy, preview, lucky pending, rip, runtime) before one swap with a 2000 ms wait (shared.js:5629-5643)

**INV-111 Use an item from the dashboard.** A character consumes an elixir, licence, spawner or a gives-item from a dashboard click when the slot still holds that item.

Rules:

- useDashboardItem requires the same item state in the slot and a supported type (shared.js:6784-6791)

## 2. What goes wrong

### Lucky slot precedence computed in three places

Kind: duplicate rule. Origin: Ryan base. Confidence: confirmed in code.

1. status/response.ts:134-140 attaches luckyUpgradeSlot = lock ?? resume.slot ?? verified ?? null to every merchant command
2. characters/shared.js:8471 and :10471 copy command.luckyUpgradeSlot into the runtime variable
3. characters/shared.js:11331-11333 recomputes the same order from polled state (Number.isInteger on the lock, truthy resume, then verified)
4. dashboard/features/party/connected-inventory.tsx:186 computes the order a third time for display
5. if none yields a valid slot 0-41, shared.js:5097-5098 falls back to luckySlotTracking().select()
6. luckyUpgradeSlots has no runtime writer: git grep finds only reads, deletes (status/lucky-slot-tracking.ts:20, 27) and merchant/initial-runtime.ts:40, which drops a saved GoldMajesty === 7

### Coordinator retry policy keys on lucky slot English text

Kind: patchwork. Origin: Ryan base. Confidence: confirmed in code.

1. runtime/characters/lucky-upgrade.ts:65-68 builds every failure as "Couldn't use lucky slot: " + reason with code lucky_slot_unavailable
2. the code is read only on the character: lucky-upgrade.ts:135 and characters/shared.js:3951
3. merchant/completion-retries.ts:67-69 treats the exact text 'Couldn't use lucky slot: item or scroll unavailable' (lucky-upgrade.ts:182) as interrupted production and retries (:70-73)
4. completion-retries.ts:136 treats any other ^Couldn't use lucky slot: text as a capacity failure, which blocks the job reason by capacitySignature (:138-140)
5. 'swap was not confirmed' after 5000 ms (lucky-upgrade.ts:77-79, 91), 'runtime interrupted' (:76), 'another upgrade owns the inventory' (:158, 179), 'source item changed during preparation' (:145) and 'scroll changed during preparation' (:207) are not capacity problems
6. (inference) a slow swap confirmation parks the upgrade job as capacity blocked until an unrelated inventory change; rewording any reason in lucky-upgrade.ts changes the retry policy
7. (inference) the merchant job completion report carries only the error text; no errorCode field was found in shared.js or merchant completion code

### homeRealm captured at queue time on commerce jobs

Kind: bug. Origin: Ryan base. Confidence: confirmed in code.

Commerce jobs keep the `homeRealm` they had when queued (runtime/coordinator/commerce/bids.ts:113, manual-orders.ts:70 and 129). The causal chain and its effect on realm hops are in [09 What goes wrong](09-merchant-realm-and-gear.md#2-what-goes-wrong).

### 120 s listing freshness repeated in seven places

Kind: duplicate rule. Origin: Ryan base. Confidence: confirmed in code.

1. commerce/bids.ts:101 (Ponty candidates) and :165 (ALData candidates)
2. commerce/manual-orders.ts:111 (manual Ponty)
3. commerce/price-history.ts:48 (current market low)
4. commerce/ponty.ts:56 (dismiss window)
5. http/manual-market-orders.ts:52 (manual ALData)
6. runtime/market-preferences.ts:8-10 defines marketListingFresh with the same 120000 window, and none of the files above use it
7. fork HEAD npc-shop.ts:97 adds FRESH_PONTY_MS = 120000; fork HEAD http/manual-market-orders.ts lets check: true bypass the rule

### Item and listing identity has many encodings

Kind: patchwork. Origin: Ryan base. Confidence: confirmed in code.

1. partial match ignoring q, price, rid, b, giveaway: inventory/item-identity.ts:3, 10-18 (one direction only); compound-marks.ts:8-10 and bank-upgrade-receipts.ts:12 call it both ways
2. name@+level: item-identity.ts:20-24; shared-rules.ts:128 and offering-supply.ts:68 rebuild it inline
3. name@level: exchange keys at automatic-action.ts:99, clear-item-marks.ts:123, merchant-item-commands.ts:84; craft needs at runtime/craft-reservations.ts:12, 19
4. JSON [name, level, p, stat_type]: item-identity.ts:37-44; JSON [name, level, stat_type]: storage-service.ts:51-60
5. stack identity of 9 fields: runtime/bank-stacks.ts:16-19, copied verbatim at scripts/bank-stack-routing.cjs:7-10
6. Ponty groupKey (sorted JSON without rid, q, price): scripts/ponty-market.cjs:1-5; Ponty key region:identifier:rid: ponty-market.cjs:48 and status/ponty.ts:44
7. ALData listing key of 7 fields: market-normalization.ts:4-14; seller tuple twice: merchant-blacklist.ts:3-7 (with name fallback) and purchase-progress.ts:32-41 (without)
8. name|level: runtime/market-preferences.ts:7; non-null JSON: runtime/characters/lucky-upgrade.ts:19-20
9. exact JSON of whole requests or items: bankboi-completion.ts:112, transfer-commands.ts:48, 52, 127, 168, reservations.ts:31, 44, mark-commands.ts:73, clear-item-marks.ts:188, merchant-item-commands.ts:125, http/inventory-receipts.ts:35
10. legacy branches: item-identity.ts:33, initial-intents.ts:24, upgrade-marks.ts:133-135, upgrade-continuation.ts:37-41, shared-rules.ts:144-150, 167

### A blocked native WTB offer with a native id is never released

Kind: bug. Origin: Ryan base. Confidence: confirmed in code.

1. commerce/native-stand.ts:144 blocks a placed offer whose slot is empty while the stand is open: 'Offer disappeared without a confirmed fill/removal; reconciliation required'
2. block() sets retryAt only when the offer has no rid (native-stand.ts:76-79)
3. retryUnconfirmed releases only offers without rid (native-stand.ts:126-127); recoverConfirmed needs the same rid back in the slot (:103-106)
4. plan() skips blocked offers instead of removing them (native-stand.ts:191)
5. creation() skips any item that still has an offer, so no new native WTB is placed for that bid (native-stand.ts:179)
6. http/native-stand.ts:100 nativePurchaseLimit returns 0 while any offer exists for the item, so stand, ALData and Ponty purchase reservations for that bid get quantity 0 (http/native-stand.ts:27-31)
7. git grep finds no other writer that deletes ledger offers; resolve-purchase only handles purchases (http/native-stand.ts:52-62)
8. (inference) a full fill whose receipt is lost (character restart) or a manual in-game removal triggers it

Commits:

- 475fe2d2 2026-09-30 Breene26: fix: recover unconfirmed WTB placements (added retryAt for offers without rid)
- 31dbf2e3 2026-09-30 Breene26: Fix market and WTB workflows

### Stat scroll count misses the game's top grade

Kind: game-rule mismatch. Origin: Ryan base. Confidence: confirmed in code.

1. inventory/stat-scroll-commands.ts:66-72 requires 1000 scrolls at level >= grades[2] and never more
2. the game's calculate_item_grade returns 4 at level >= grades[3] (default [9,10,11,12]) (adventureland_mongodb js/old_common_functions.js:798-806)
3. the pscroll branch needs [1, 10, 100, 1000, 9999][grade] scrolls (node/server.js:7465-7468)
4. (inference) a +12 item with default grades passes the console check with 1000 scrolls and the game answers upgrade_scroll_q

### Price history emptyMarket flag has no effect

Kind: dead code. Origin: Ryan base. Confidence: confirmed in code.

1. commerce/market-feeds.ts:41 passes emptyMarket = no ALData listings yet
2. price-history.ts:31, 39-44 write marketLow from that flag in recordListing
3. price-history.ts:64-73 then sets or deletes marketLow on every history entry from the 120 s lows, overwriting the flag's value in the same call

### Saved ALData requestTimes is never read

Kind: dead code. Origin: Ryan base. Confidence: confirmed in code.

1. commerce/initial-aldata.ts:32 creates aldata.requestTimes
2. the rate limit uses the client's own closure array (commerce/aldata-client.ts:16-27); git grep finds no other reader

### Exchange and processing rules duplicated between mark removers

Kind: duplicate rule. Origin: Ryan base. Confidence: confirmed in code.

1. inventory/automatic-action.ts:97-108 clearExchange and clear-item-marks.ts:109-124 clearQueuedExchanges filter queued exchange jobs with the same name@level logic
2. automatic-action.ts:132-140 upgradePending and compoundPending repeat shared-rules.ts:122-130 activeUpgrade and the compound clause of processingPending
3. clear-item-marks.ts:205-208 clearSharedCollection repeats automatic-action.ts:43-46

### Two bank snapshot writers and two vault list sources

Kind: patchwork. Origin: Ryan base. Confidence: confirmed in code.

1. status/bank.ts:41-45 replaces the snapshot only on content or observer change, then adopts cargo and persists
2. http/bankboi-storage.ts:47-51 overwrites it on every BankBoi checkpoint or completion without that comparison
3. bank vaults come from game files at start (inventory/initial-bank.ts:11, infrastructure/game-data.ts:16-38) and are replaced by any report carrying bankVaults (status/catalogs.ts:74-80)

### Mail automation pulls the whole inbox per message

Kind: patchwork. Origin: Ryan base. Confidence: confirmed in code.

1. mailbox.ts:22-30 refreshes the inbox, then for each mail to collect calls inner.collect, which refreshes again (scripts/mail-inbox.cjs:50)
2. each auto delete calls inner.remove, which refreshes before and after delete_mail (mail-inbox.cjs:65, 74)
3. complete() refreshes the inner inbox (mail-inbox.cjs:80) and the outer mailbox again (mailbox.ts:36)
4. each refresh pages pull_mail until done (mail-inbox.cjs:21-41), so N actions cost about N to 2N extra full pulls per 30 s cycle

Commits:

- 9454392e 2026-10-18 Breene26: mailbox automation
- 198562f8 2026-10-19 Icelocked: keep the newest 2000 mail read marks

### BankBoi transaction recovered by age alone after 600 s

Kind: wrong value. Origin: Ryan base. Confidence: inference.

1. inventory/bankboi-service.ts:141-147 abandons any transaction older than 600 000 ms without checking the worker
2. start() then marks the worker interrupted with a 10 s retry and restores the merchant (bankboi-service.ts:148-155, bankboi-composition.ts:61-64)
3. (inference) a BankBoi still working through 7 requests and 7 retrievals past 10 minutes is stopped mid-run; the bank stack journal then retires its intent after 30 s (characters/bank-stacks.ts:115-124)

### BankBoi completion dedupe lives in memory

Kind: patchwork. Origin: Ryan base. Confidence: confirmed in code.

1. http/bankboi-storage.ts:45 keeps the last 32 completion receipts in a Set
2. a restart loses it; ownsCompletion then guards by transaction and commandId only (bankboi-storage.ts:92-95, 99-102)

### Failure kinds travel as text

Kind: patchwork. Origin: Ryan base. Confidence: confirmed in code.

1. production.ts:53-54, 82, 85, 249 throw texts returned as 409 String(error), so the client sees an 'Error: ' prefix (production.ts:154)
2. merchant/dispatcher.ts:261 logs 'Production recovery pending' again
3. bankboi-composition.ts:63 stores error 'interrupted', matched as text at merchant/completion-retries.ts:72 and http/merchant-idle.ts:50
4. stand-marks route picks 409 by comparing the error text (http/stand-marks.ts:83)
5. withdrawal-bank-guard.ts:22 auto_bank_confirmation_required and marketplace-progress failure codes (http/marketplace-progress.ts:12-17) are the typed exceptions

### Upgrade intent has many writers and four identity fields

Kind: patchwork. Origin: Ryan base. Confidence: confirmed in code.

1. upgrades[name] is written at upgrade-commands.ts:67-69, 88, 117, 154; mark-reconciliation.ts:71, 81; upgrade-continuation.ts:32-33, 46, 66; offering-waits.ts:34-35; offering-supply.ts:152; production.ts:242; transfer-commands.ts:159-164; bankboi-completion.ts:123; bank-upgrade-receipts.ts:13; clear-item-marks.ts:55, 83-85; automatic-action.ts:52; compound-commands.ts:151; reservations.ts:36
2. marks carry slot, liveSlot, requestId and legacy passId plus storage (upgrade-marks.ts:4-18)
3. readers choose different orders: offering-waits.ts:43-44, 91-94; offering-supply.ts:60, 93; upgrade-continuation.ts:28, 80-83; upgrade-marks.ts:132-135

Commits:

- 4030efac 2026-09-21 Ryan Haines: upgradeInventoryBusy skip
- 9273ecb4 2026-10-14 Breene26: pending recovery bundle

### Gold reserve applies only to fork watch orders

Kind: patchwork. Origin: fork added. Confidence: confirmed in code.

1. fork HEAD npc-shop.ts:131-142 spendableGold = merchant + bank gold - goldReserve - unfinished listings of jobs with npcOrderId only
2. Ryan's bid jobs read no reserve: commerce/bids.ts:133-202, manual-orders.ts:62-141
3. native stand funding takes the highest allocated bid price up to merchant + bank gold (http/native-stand.ts:67-77, 113-116)
4. so watch budget ignores pending Ryan bid purchases, and bid purchases can spend below the reserve
5. bids.ts:93-103 Ponty candidates do not skip listing keys already held by a watch job, so both can target one listing (fork HEAD application.ts:1556-1560 runs matchPonty first)
6. (inference) the character's own gold check at purchase time is the only limit; not traced in this slice

Commits:

- 9476cd15 2026-10-22 Icelocked: feat: buy from Ponty and Ron with standing orders

### Local stand bid jobs skip the producer steps other bid jobs take

Kind: patchwork. Origin: Ryan base. Confidence: inference.

1. commerce/local-market.ts:104-111 pushes a 'stand bid purchases' job without ports.stamp, persist or dispatch
2. bids.ts:145-152, 198-199 stamp, persist and dispatch their jobs
3. (inference) the stand bid job relies on the caller's later persist and dispatch and gets its priority fields at pick time

### Ponty secondhand price formula duplicated by the fork

Kind: duplicate rule. Origin: fork added. Confidence: confirmed in code.

1. Ryan's scripts/ponty-market.cjs:6-35 prices Ponty listings from calculate_item_value (adventureland_mongodb js/old_common_functions.js:808-847)
2. fork HEAD runtime/coordinator/commerce/npc-price.ts:23-74 reimplements the same formula for Ponty and Ron estimates
3. the two differ in fallback scroll prices: ponty-market.cjs:15, 22 use fixed defaults; npc-price.ts:23 uses 0 for a missing definition

Commits:

- 9476cd15 2026-10-22 Icelocked
- 6f4ed09a 2026-10-22 Icelocked

### Stand capacity hard-coded at 16 slots

Kind: game-rule mismatch. Origin: Ryan base. Confidence: confirmed in code.

1. the game gives a stand 16 trade slots, 24 for a merchant at level 70 or with a cstand, 30 at level 80 (game server_functions.js:4365-4376)
2. automatic-sales.ts:88 (standReserved) and :184 (resumeDisplacedSales) cap listings plus slot-using bids at 16
3. stand-marks.ts:107 (markAll) and :152 (single) cap at 16; occupied() at :43-45 counts the same set
4. shared.js:9382 places at most 16 native WTB offers per reconcile; merchantIdle loops trade1-trade16 only (shared.js:9537, 9559)
5. result: a level 70+ merchant never uses 8 to 14 of its trade slots, and listings in trade17+ placed by hand are never reconciled (inference)

Commits:

- 9fbeadab 2026-09-20 Ryan Haines: initial console (git log of the 16 literals not traced further)

### Max item levels disagree with the game

Kind: game-rule mismatch. Origin: Ryan base. Confidence: confirmed in code.

1. maximumItemLevel returns 7 for compound items and 13 for upgrade items (shared.js:1397-1399)
2. the game's tables stop at upgrade +12 and compound +10: design/upgrades.js upgrades keys 1-12, compounds keys 1-10; server.js:7143-7148 answers 'upgrade_cant' past the table and server.js:6882 does the same for compounds
3. upgrade marks are capped at 13 by upgradeMarked (shared.js:3865), merchantImprove (shared.js:6224-6225) and findUpgradeMarkSlot (shared.js:6074), and banked-improvements.ts:35 accepts an auto upgrade rule up to level + tiers = 13
4. the catalog reports maxLevel 7 for every compound item (shared.js:1776, 2248), so a +8 to +10 compound target is never offered (inference: depends on the dashboard reading maxLevel)
5. an auto upgrade rule to +13 can never finish and keeps scheduling attempts that the game refuses (inference)

### Stat-scroll confirmation fails after the scroll is applied

Kind: bug. Origin: Ryan base. Confidence: confirmed in code.

1. the game queues a stat scroll for 2000 x tmult x tmult ms (tmult 1, 1.5 or 2 by the item's base grade), halved by massproduction, and leaves level unchanged (game server.js:7153-7160, 7465-7512)
2. merchant path: applyStatScrolls calls raw upgrade() without merchantMassBuff and waits only 2500 ms for stat_type before throwing 'Native stat-scroll outcome was not confirmed' (shared.js:6641-6645); a grade-1 base item needs 4500 ms and a grade-2 base item 8000 ms
3. fighter path: applyOwnedStatScrolls calls upgradeConfirmed (shared.js:6711), which routes stat scrolls to observedUpgradeConfirmed then upgradeAtSlotConfirmed (shared.js:5032-5033, 5081)
4. upgradeAtSlotConfirmed defaults expectedLevel to level+1 (shared.js:5186-5187), so after the stat is applied it throws upgrade_result_not_confirmed 1500 ms later (shared.js:5224-5233)
5. applyOwnedStatScrolls re-equips and rethrows (shared.js:6718-6725): the run reports failure after spending the scrolls, and the mark no longer matches the changed item (inference)

Commits:

- 54159cac 2026-10-18 Breene26: fix: advance delivery identity only from observed stat mutation (added the 2500 ms stat_type poll)
- 7dfbec89 2026-10-12 Breene26: the scroll-name branch in upgradeConfirmed

### Auto compound evaluation carries dead completion logic

Kind: dead code. Origin: Ryan base. Confidence: confirmed in code.

1. evaluateAutoCompounds never pushes to completed, and its filter returns true on every path, so remaining always equals rules (automatic-improvements.ts:40-54); this has been so since 9fbeadab
2. evaluateCompound writes the same rules back and loops over the always-empty completed to log 'Auto compound quantity reached' (improvement-scheduler.ts:140-147)
3. sharedCompounds calls evaluateAutoCompounds on improvementItems only to take .remaining, which is the input unchanged (improvement-scheduler.ts:122)
4. result: a compound rule's quantity is never retired at the coordinator; only merchantImprove's per-pass count stops work (shared.js:6331-6339)

Commits:

- 9fbeadab 2026-09-20 Ryan Haines: initial console, already in this state

### bank_retrieve loops with no settle wait

Kind: patchwork. Origin: Ryan base. Confidence: inference.

1. bankStoreFully's own comment says a bank promise can resolve before the inventory proxy updates (shared.js:4140-4141), and bankRetrieveConfirmed polls up to 5000 ms for that reason (shared.js:4600-4605)
2. retrieveFromBankUntil (shared.js:1336-1345) and merchantALDataSell (shared.js:8983-8987) loop up to 100 bank_retrieve calls re-reading the lagging proxy; each bank call costs about 2 of the 200-per-4-s budget (game server.js:248-262; review 6.1)
3. prepareBankUpgrades checks the slot right after bank_retrieve and throws 'Bank upgrade withdrawal was not confirmed' (shared.js:7259-7263)
4. merchantNpcSale looks the item up right after bank_retrieve and blocks 'NPC-sale item changed before sale' (shared.js:9246-9252)
5. merchantBankErrands NPC-sale withdrawals (shared.js:6029), goBank (shared.js:4484) and saved-scroll withdrawals in merchantCommerce (shared.js:7918-7924) also skip the wait
6. result (inference): spurious failures under proxy lag, and a burst of repeated withdrawals of the same cell in the 100-call loops

### Stand reconcile unequips every listing in one burst

Kind: bug. Origin: Ryan base. Confidence: inference.

The stand reconcile sends up to 16 unequips back to back (characters/shared.js:9537-9550). Its call cost and causal chain are in [09 What goes wrong](09-merchant-realm-and-gear.md#2-what-goes-wrong).

### Mail with attachment has no gold check

Kind: bug. Origin: Ryan base. Confidence: confirmed in code.

1. the game charges 48000 gold for a mail and 360000 with an item, and fails 'gold_not_enough' (game logic/mail.js:143-144)
2. merchantSendMail never compares gold or visits the bank before send_mail (shared.js:10326-10367), unlike merchantALDataAuth (shared.js:8681-8687)
3. result: a merchant carrying less than 360000 gold fails every attachment mail after already withdrawing, splitting and moving the item (shared.js:10338-10365)

### Self improve can strand stat-scroll gear unequipped

Kind: bug. Origin: Ryan base. Confidence: inference.

1. merchantSelfImprove unequips equipped stat-scroll marks before any supply step (shared.js:7318-7322)
2. only applyStatScrolls records them for re-equip, and only when mark.equipped is set (shared.js:6650-6651)
3. the failure path restores only command.upgrades marks (shared.js:7275-7293, 7380), so a throw in preloadStatScrolls, prepareManualImprovementScrolls or bank steps leaves the stat-scroll gear in the bag (inference)

Commits:

- 03ee191e, 9273ecb4, 5943750b, 54159cac (merchantSelfImprove history, review Appendix C 3)

### bidPurchases is always empty

Kind: dead code. Origin: Ryan base. Confidence: confirmed in code.

1. merchantStandBuy and merchantPontyBuy declare completed = [] and never push to it (shared.js:8526, 8590)
2. both send bidPurchases: completed on success and failure (shared.js:8555, 8560, 8663, 8669)
3. completion-results.ts:134 loops over body.bidPurchases, so that loop never runs; purchases are recorded through the native-stand 'purchased' receipt instead (shared.js:9403-9404)

### The 3-slot inventory reserve is restated with three formulas

Kind: duplicate rule. Origin: Ryan base. Confidence: confirmed in code.

1. purchasePreservesLogisticsReserve needs free slots minus needed slots >= 3 using isize (shared.js:5405-5414)
2. goBank and merchantBankErrands stop at freeInventorySlots() <= 3 (shared.js:4480, 5951)
3. merchantBankErrands NPC sales and prepareBankUpgrades use the game's character.esize <= 3 (shared.js:6023, 7250)
4. merchantBuyUpgradeLine counts null array entries minus 3 (shared.js:7655); reconcileNativeStand reports space as more than 3 null entries (shared.js:9350)
5. canReceiveCompoundInputs needs more than 3 empty status entries (improvement-scheduler.ts:56-58)

### Raw socket emits bypass the game wrappers

Kind: patchwork. Origin: Ryan base. Confidence: confirmed in code.

1. merchantExchange emits exchange_buy through parent.push_deferred and parent.socket.emit to pick the verified stack (shared.js:8356-8361)
2. merchantDonate emits parent.socket.emit('lostandfound','info') and sleeps 350 ms (shared.js:9296-9298)
3. a call budget installed on the game functions would miss both (review Appendix C 2, finding 4)

Commits:

- e4373456 (Thefonze #28) merchantExchange stack merge, per review Appendix C 3

### Commerce v2 remap fix-on-fix chain

Kind: patchwork. Origin: Ryan base. Confidence: confirmed in code.

1. other systems move merchant inventory while a paid batch runs (lucky slot swap shared.js:5120, bank sort buffer shared.js:4419-4439, Tracktrix pin shared.js:5640)
2. remapCommerceOwnedItems remaps whole owned groups and throws on any count mismatch (shared.js:7416-7445)
3. matchingSlot remaps again on every lookup (shared.js:7487-7501) and adoptIntermediateInventory adopts an intermediate survivor (shared.js:7580-7607)

Commits:

- fde2186d 2026-10-09 Breene26: Recover owned merchant batches after inventory slot movement
- 2be25ed8 2026-10-09 Breene26: fix: recover owned intermediate stock and preserve adoption audit
- 6f532e38 2026-10-18 Breene26: fix: remap running merchant upgrade batches after item movement

### Lucky restoration lowered to best effort

Kind: patchwork. Origin: Ryan base. Confidence: confirmed in code.

1. merchantLuckyUpgrade's warn port logs 'Lucky slot restoration skipped; leaving items in their current positions' instead of failing (shared.js:5136-5142)
2. every consumer then re-finds items after an upgrade (shared.js:5104-5107, 6254-6257, 7491-7501)

Commits:

- 17400329 2026-10-10 Breene26: feat: capture map views and make lucky restoration best effort

### Legacy compound leveling path unreachable for validated orders

Kind: dead code. Origin: Ryan base. Confidence: inference.

1. normalizeLine rejects level > 0 for a choice that is not upgradeable (order-validation.ts:5-10)
2. merchantCatalog marks compound items upgradeable false (shared.js:2255)
3. so merchantCommerce's compound branch (shared.js:8132-8157) runs only for orders saved before that validation (inference)

### BankBoi provision bursts unequip and sell calls

Kind: bug. Origin: Ryan base. Confidence: inference.

1. provision unequips every equipment slot then sells every inventory slot back to back with no delay (shared.js:4682-4688)
2. the inventory sort fires swap() without await, 120 ms apart (shared.js:4763)
3. unequip costs 1 + CC 6 plus resends (game server.js:248-262); review 6.1 estimates about 159 for a full provision in under a second

Commits:

- dc384390 2026-10-11 Breene26: Fix bank staging, party exchange, Tracktrix and stale navigation

### Donation rate boundary off by one

Kind: wrong value. Origin: Ryan base. Confidence: confirmed in code.

1. donationRateListener uses 4 only while server gold < 1000000000 (shared.js:876)
2. the game uses S.gold <= 1000000000 for 4 (game server.js donate handler)
3. result: at exactly 1000000000 gold the dashboard shows 3.2 instead of 4

### Fork recoverSpace undercounts compound space

Kind: bug. Origin: fork added. Confidence: inference.

1. recoverSpace unblocks a mark when free slots >= catalog rewards length, or 1 when the catalog has no rewards (fork HEAD deconstruction.ts:230-239)
2. buildDeconstructionCatalog gives compound entries no rewards (deconstruction.ts:64-66)
3. the character needs 2 free slots for a compound dismantle (shared.js:9174-9175; game dismantle handler esize < 2)
4. result: with exactly 1 free slot a compound mark unblocks, fails 'Insufficient inventory space for deconstruction results' (shared.js:9206) and blocks again every 120000 ms (inference)

Commits:

- 9f7e581e 2026-10-15 Icelocked: fix(deconstruction): retry a mark blocked by a full bag once there is room

### Failure text is the contract with the coordinator

Kind: patchwork. Origin: Ryan base. Confidence: confirmed in code.

1. 'bankboi_pending' is thrown at shared.js:4160, 6162, 8334 and compared at 6187, 7385, 8214, 8412; completion-retries.ts:41 matches it
2. 'bank_full' and 'inventory_full' (shared.js:4131, 6418, 7364) are matched by completion-retries.ts:136
3. 'Upgrade inventory recovery ambiguous:' (shared.js:6086) is matched by completion-retries.ts:124; 'Upgrade outcome uncertain' (shared.js:5012, 5107, 5228, 7562) by completion-retries.ts:113-114
4. 'Marked item is not in merchant inventory' is written and matched inside npc-sales.ts:40, 45; 'Marked item is missing; refresh inventory before retrying' inside deconstruction.ts:198, 221
5. the fork's recoverSpace matches the character's text 'Insufficient inventory space for deconstruction results' across the wire (shared.js:9206; fork HEAD deconstruction.ts:233)

## 3. Fork differences

What the fork (af92de45) adds or changes in this part. Fork code is not in Ryan's catalog; its lines are fork HEAD.

| What | Commits | What it patches | Where |
|---|---|---|---|
| Ponty and Ron watch and buy-now orders (npc-shop.ts) | 9476cd15 2026-10-22 Icelocked: feat: buy from Ponty and Ron with standing orders, 388b9248 2026-10-22 Icelocked: fix: let a queued Ron visit take the current donation consent, 6f4ed09a 2026-10-22 Icelocked: feat: watch list for Ponty and Ron, plus market filters and newest-first sort, 369d64be 2026-10-22 Icelocked: docs: say which item fields the listing identity leaves out, df1858c6 2026-10-25 Icelocked: Match Ponty watch orders against the home realm | Adds standing Ponty watches and Ron visits that Ryan's bid-only Ponty buying lacks; df1858c6 limits Ponty watches to the home realm to stop the US II and EU II hop loop (ledger 1); 388b9248 lets queued Ron jobs take a new donation consent; 6f4ed09a adds firstSeenAt stamping on Ponty and ALData feeds and a migrate() shim for the 9476cd15 order shape | fork HEAD runtime/coordinator/commerce/npc-shop.ts:101-122 (migrate), 131-142 (spendableGold), 357-430 (matchPonty, select, eligible, queuePonty), 438-459 (fulfilled), 466-546 (Ron); wiring fork HEAD application.ts:1539-1565 |
| Ponty and Ron price helpers (npc-price.ts) | 9476cd15 2026-10-22 Icelocked, 6f4ed09a 2026-10-22 Icelocked | Gives the dashboard per-level unit prices and total estimates for watches; Ron = 4 x calculate_item_value; duplicates the formula in scripts/ponty-market.cjs:6-35 | fork HEAD runtime/coordinator/commerce/npc-price.ts:23-88 |
| Stat scroll name from prim-stack | 2055dd82 2026-10-20 Icelocked: feat: prim stack an item's grace (#65) | Moves the local scrollName helper to statScrollName in runtime/prim-stack.ts so the prim stack feature shares it; the mapping is unchanged (mp_cost -> mpcostscroll) | fork HEAD runtime/coordinator/inventory/stat-scroll-commands.ts:2, 99, 117; runtime/prim-stack.ts:32-34 |
| Manual ALData order 'check' flag | eb9acad0 2026-10-20 Icelocked: feat(market): sort owned WTB matches to top, hide stale, check stale listings | Lets the user send the merchant to verify a listing older than 120 s instead of being refused (#34); bypasses Ryan's freshness rule for that one order | fork HEAD runtime/coordinator/http/manual-market-orders.ts:50-53, 62-66, 79 |
| Gapped bank sort layout | 3dc61c45 2026-10-20 Icelocked: feat(bank): optional gapped bank sort that moves few items per change, bb37238c 2026-10-20 Icelocked: Keep the bank sort checkpoint under the complexity limit | Ryan's packed sort shifts the whole bank on every new item; the gapped layout starts each category on its own 7-slot row with spare slots so a change moves few items. The checkpoint returns layout with mode; sortCurrentBankFloor includes the layout in its signature | fork HEAD characters/shared.js:4601, 4617-4623, 4800-4881, 4905, 4930-4935; runtime/coordinator/merchant/bank-sort.ts:17-18, 31, 39, 92, 99-101, 116-118 |
| Deconstruction recoverSpace | 9f7e581e 2026-10-15 Icelocked: fix(deconstruction): retry a mark blocked by a full bag once there is room | Ryan's base leaves a mark blocked by 'Insufficient inventory space for deconstruction results' until the operator retries; the fork retries after 120000 ms once enough slots are free, matching the character's error text (see problem 'Fork recoverSpace undercounts compound space') | fork HEAD runtime/coordinator/merchant/deconstruction.ts:92, 187, 230-239 |
| Ponty secondhands pacer and per-realm reads | c3a8a57d 2026-10-24 Icelocked: Pace the merchant's Ponty secondhands calls under the game's rate limit | the game disconnected the merchant with limitdc ['secondhands',208] after 13 reads in 4 s (comment at fork HEAD shared.js:9216-9220); pontySecondhands spaces every read 1.5 s apart and merchantPontyBuy reads once per realm and again only after a purchase | fork HEAD characters/shared.js:1294, 9120-9129, 9159, 9184, 9215-9230 |
| Ron (lostandfound) purchases | 9476cd15 2026-10-22 Icelocked: feat: buy from Ponty and Ron with standing orders | adds a Ron visit job that donates 1000000 gold when Ron answers donation_required (if allowed), reports stock priced at value x 4 (matches the game's mult 4, server.js sbuy handler), and buys the coordinator's chosen rids; it does not use guardedMarketPurchase or the 3-slot reserve | fork HEAD characters/shared.js:9899-9977; runtime/coordinator/commerce/npc-shop.ts |
| Prim stack (grace stacking) | 2055dd82 2026-10-20 Icelocked: feat: prim stack an item's grace (#65), 276febc7 2026-10-20 Icelocked: Join catalog meta before a prim stack reads an item's definition | adds a 'prim stack' job that raises an item's grace with offeringp (0.5 per stack, 1 with the item's stat scroll); the operation calls upgrade() directly with a 30000 ms poll, outside trackedProduction, the production journal and the lucky slot; the coordinator route validates target 0.5-15 and supply | fork HEAD characters/shared.js:2698-2777; runtime/coordinator/merchant/prim-stack.ts:22-76 |
| merchantHandoff pickup authorization (cite only) | 947fa15e 2026-10-20 Icelocked: fix(merchant): send auto-merchant copies that also feed a compound rule | patches the fighter's handoff send loop so automatic merchant copies that also feed a compound rule are sent; merchantHandoff belongs to spec 08 | fork HEAD characters/shared.js:6352-6366 (review Appendix C 0) |
| Gear sets added then removed (net zero) | f4df566c 2026-10-20 Icelocked: feat(gear): saved luck and tank gear sets with a kill-time luck swap, fdb0147a 2026-10-25 Icelocked: Remove gear sets and the kill-time luck swap | f4df566c added swapHeld checks to deconstruction automatic marking and player NPC sale protection (deconstruction.ts:156, player-npc-sales.ts:183) plus handoff hooks; fdb0147a removed them. player-npc-sales.ts equals Ryan at HEAD; deconstruction.ts differs only by recoverSpace | git show f4df566c and fdb0147a on runtime/coordinator/merchant/deconstruction.ts, player-npc-sales.ts |

## 4. Tests today

Tests were mapped to behaviours by what they load: a unit test that requires a TypeScript file maps to the behaviours that own functions in that file, and a test that slices characters/shared.js maps to the behaviours whose functions it names. Within a file, each test goes to the behaviour whose title shares the most words with the test name. The per-test list is in the catalog file. The mapping is mechanical; whether each test proves what its name says, passes for the right reason and matches the game has not been reviewed yet (Gaps).

| Test file | Tests mapped here | Behaviours |
|---|---|---|
| e2e/console.spec.ts | 6 | INV-063, INV-087, INV-089 |
| scripts/tests/active-wtb-fields.test.cjs | 3 | INV-011 |
| scripts/tests/anniversary-bankboi-supplies.test.cjs | 3 | INV-053 |
| scripts/tests/anniversary-kiss.test.cjs | 22 | INV-062 |
| scripts/tests/auto-stand-banner.test.cjs | 2 | INV-099 |
| scripts/tests/bank-consolidation.test.cjs | 5 | INV-065 |
| scripts/tests/bank-deconstruction.test.cjs | 5 | INV-101 |
| scripts/tests/bank-improvements.test.cjs | 7 | INV-068, INV-102, INV-103 |
| scripts/tests/bank-partial-stacks.test.cjs | 18 | INV-051 |
| scripts/tests/bank-sort-request.test.cjs | 19 | INV-066, INV-069, INV-070 |
| scripts/tests/bank-stack-routing.test.cjs | 22 | INV-053, INV-062, INV-064, INV-065, INV-066, INV-073 |
| scripts/tests/bankboi-recovery.test.cjs | 4 | INV-055 |
| scripts/tests/bankboi-scheduler.test.cjs | 13 | INV-053, INV-055 |
| scripts/tests/bankboi-transfer-confirmation.test.cjs | 3 | INV-064, INV-067, INV-073 |
| scripts/tests/barrier-communication.test.cjs | 13 | INV-093 |
| scripts/tests/catalog-startup.test.cjs | 3 | INV-063 |
| scripts/tests/catalog-validation.test.cjs | 4 | INV-049 |
| scripts/tests/character-field-registry.test.cjs | 10 | INV-064 |
| scripts/tests/clear-item-marks.test.cjs | 7 | INV-022, INV-026 |
| scripts/tests/combat-movement.test.cjs | 36 | INV-093 |
| scripts/tests/compound-marks.test.cjs | 5 | INV-038 |
| scripts/tests/compound-storage-behavior.test.cjs | 8 | INV-039, INV-061, INV-102, INV-103 |
| scripts/tests/convoy-communication.test.cjs | 22 | INV-062 |
| scripts/tests/coordinator-account-character-actions.test.cjs | 3 | INV-059 |
| scripts/tests/coordinator-aldata-routes.test.cjs | 3 | INV-005 |
| scripts/tests/coordinator-automatic-sales.test.cjs | 8 | INV-097, INV-098 |
| scripts/tests/coordinator-bank-actions.test.cjs | 1 | INV-057 |
| scripts/tests/coordinator-bankboi-composition.test.cjs | 3 | INV-055 |
| scripts/tests/coordinator-bankboi-routes.test.cjs | 11 | INV-057, INV-059 |
| scripts/tests/coordinator-bids.test.cjs | 3 | INV-006, INV-011 |
| scripts/tests/coordinator-character-actions.test.cjs | 2 | INV-023 |
| scripts/tests/coordinator-character-command.test.cjs | 11 | INV-023, INV-044, INV-080 |
| scripts/tests/coordinator-character-creation.test.cjs | 7 | INV-059 |
| scripts/tests/coordinator-compound-commands.test.cjs | 4 | INV-038 |
| scripts/tests/coordinator-craft-storage.test.cjs | 5 | INV-058, INV-060 |
| scripts/tests/coordinator-exchange-routes.test.cjs | 3 | INV-040 |
| scripts/tests/coordinator-game-data.test.cjs | 4 | INV-049 |
| scripts/tests/coordinator-heartbeat-composition.test.cjs | 5 | INV-053 |
| scripts/tests/coordinator-improvement-scheduler.test.cjs | 8 | INV-086, INV-102 |
| scripts/tests/coordinator-inventory-receipts.test.cjs | 4 | INV-043, INV-050 |
| scripts/tests/coordinator-item-commands.test.cjs | 12 | INV-023, INV-043 |
| scripts/tests/coordinator-legacy-schedulers.test.cjs | 1 | INV-050 |
| scripts/tests/coordinator-mail-startup.test.cjs | 3 | INV-017 |
| scripts/tests/coordinator-mail.test.cjs | 7 | INV-017, INV-019 |
| scripts/tests/coordinator-manual-orders.test.cjs | 4 | INV-015 |
| scripts/tests/coordinator-mark-reconciliation.test.cjs | 7 | INV-022, INV-030 |
| scripts/tests/coordinator-market-account.test.cjs | 2 | INV-002, INV-019 |
| scripts/tests/coordinator-market-feeds.test.cjs | 4 | INV-002 |
| scripts/tests/coordinator-market.test.cjs | 9 | INV-002, INV-003, INV-004, INV-005, INV-010, INV-013 |
| scripts/tests/coordinator-marketplace-location.test.cjs | 2 | INV-014 |
| scripts/tests/coordinator-marketplace-progress.test.cjs | 6 | INV-014 |
| scripts/tests/coordinator-merchant-delivery-actions.test.cjs | 1 | INV-019 |
| scripts/tests/coordinator-merchant-item-commands.test.cjs | 3 | INV-042 |
| scripts/tests/coordinator-merchant-order.test.cjs | 5 | INV-060, INV-084 |
| scripts/tests/coordinator-merchant-queue.test.cjs | 2 | INV-102 |
| scripts/tests/coordinator-publication-scheduler.test.cjs | 2 | INV-005 |
| scripts/tests/coordinator-purchases.test.cjs | 2 | INV-010 |
| scripts/tests/coordinator-reservations.test.cjs | 2 | INV-028 |
| scripts/tests/coordinator-reserved-cargo.test.cjs | 5 | INV-058 |
| scripts/tests/coordinator-restock-completion.test.cjs | 3 | INV-060 |
| scripts/tests/coordinator-sale-routes.test.cjs | 7 | INV-096, INV-097, INV-099 |
| scripts/tests/coordinator-scatter.test.cjs | 3 | INV-049 |
| scripts/tests/coordinator-scheduling.test.cjs | 3 | INV-043, INV-050 |
| scripts/tests/coordinator-stand-control.test.cjs | 5 | INV-011, INV-054 |
| scripts/tests/coordinator-status-composition.test.cjs | 2 | INV-005, INV-006 |
| scripts/tests/coordinator-status-ingestion.test.cjs | 4 | INV-006, INV-048, INV-049 |
| scripts/tests/coordinator-storage-controls.test.cjs | 5 | INV-013, INV-049, INV-060 |
| scripts/tests/coordinator-storage-observation.test.cjs | 2 | INV-056 |
| scripts/tests/coordinator-storage-observations.test.cjs | 2 | INV-048 |
| scripts/tests/coordinator-storage-service.test.cjs | 2 | INV-040 |
| scripts/tests/coordinator-upgrade-commands.test.cjs | 4 | INV-029 |
| scripts/tests/craft-bank-confirmation.test.cjs | 3 | INV-060 |
| scripts/tests/craft-compound-reservations.test.cjs | 12 | INV-069, INV-079, INV-083, INV-085, INV-102, INV-103 |
| scripts/tests/deconstruction-rewards.test.cjs | 2 | INV-101 |
| scripts/tests/deconstruction.test.cjs | 13 | INV-020, INV-062, INV-094, INV-101 |
| scripts/tests/delivery-precedence.test.cjs | 4 | INV-039, INV-043, INV-085 |
| scripts/tests/emergency-cleanout.test.cjs | 3 | INV-062 |
| scripts/tests/encounter-recovery.test.cjs | 8 | INV-062 |
| scripts/tests/escape-to-farm.test.cjs | 1 | INV-029 |
| scripts/tests/event-bank-recovery.test.cjs | 7 | INV-062, INV-064, INV-068, INV-102 |
| scripts/tests/farm-zone-recovery.test.cjs | 29 | INV-106 |
| scripts/tests/geometry-reload-client.test.cjs | 3 | INV-062 |
| scripts/tests/grouped-combat-coordinator.test.cjs | 5 | INV-023 |
| scripts/tests/hosting.test.cjs | 1 | INV-019 |
| scripts/tests/independent-approach-client.test.cjs | 30 | INV-062 |
| scripts/tests/inventory-delta.test.cjs | 10 | INV-064 |
| scripts/tests/inventory-loading.test.cjs | 3 | INV-063, INV-064 |
| scripts/tests/item-action-safety.test.cjs | 2 | INV-062 |
| scripts/tests/item-exchange-rewards.test.cjs | 7 | INV-041 |
| scripts/tests/item-operations.test.cjs | 8 | INV-031, INV-062, INV-075, INV-076 |
| scripts/tests/lucky-slot-tracker.test.cjs | 18 | INV-045, INV-046 |
| scripts/tests/lucky-upgrade.test.cjs | 26 | INV-047, INV-076 |
| scripts/tests/mail-inbox.test.cjs | 5 | INV-017, INV-106 |
| scripts/tests/merchant-bank-full.test.cjs | 4 | INV-061, INV-068 |
| scripts/tests/merchant-buy-cycle.test.cjs | 17 | INV-074, INV-075, INV-076, INV-082, INV-083, INV-085 |
| scripts/tests/merchant-cash.test.cjs | 4 | INV-068, INV-087 |
| scripts/tests/merchant-crafting.test.cjs | 7 | INV-065, INV-069, INV-083 |
| scripts/tests/merchant-delivery-recovery.test.cjs | 5 | INV-043, INV-044, INV-050, INV-080, INV-081 |
| scripts/tests/merchant-exchange.test.cjs | 15 | INV-040, INV-041, INV-068, INV-086 |
| scripts/tests/merchant-inventory-stacks.test.cjs | 13 | INV-053, INV-054, INV-110 |
| scripts/tests/merchant-marketplace-timeout.test.cjs | 1 | INV-014 |
| scripts/tests/merchant-npc-sales.test.cjs | 10 | INV-094, INV-095 |
| scripts/tests/merchant-party-realm.test.cjs | 1 | INV-088 |
| scripts/tests/merchant-recovery.test.cjs | 2 | INV-014 |
| scripts/tests/merchant-rendezvous.test.cjs | 1 | INV-062 |
| scripts/tests/merchant-stand-sync.test.cjs | 2 | INV-076 |
| scripts/tests/merchant-upgrade-recovery.test.cjs | 11 | INV-022, INV-027, INV-030, INV-033, INV-034, INV-047 |
| scripts/tests/native-stand-client.test.cjs | 5 | INV-016, INV-092 |
| scripts/tests/native-stand.test.cjs | 15 | INV-011, INV-012, INV-016 |
| scripts/tests/party-status-diagnostics.test.cjs | 8 | INV-076 |
| scripts/tests/phoenix-patrol-regression.test.cjs | 1 | INV-062 |
| scripts/tests/player-npc-sales.test.cjs | 7 | INV-095, INV-096 |
| scripts/tests/ponty-market.test.cjs | 7 | INV-006, INV-007 |
| scripts/tests/ponty-order.test.cjs | 3 | INV-007, INV-015 |
| scripts/tests/priest-formation.test.cjs | 57 | INV-093 |
| scripts/tests/production-journal.test.cjs | 17 | INV-033, INV-062, INV-074, INV-075, INV-076 |
| scripts/tests/production-reconciliation.test.cjs | 1 | INV-033 |
| scripts/tests/rare-hunting-client.test.cjs | 12 | INV-093 |
| scripts/tests/roster-routes.test.cjs | 1 | INV-055 |
| scripts/tests/routine-separation.test.cjs | 4 | INV-089, INV-097, INV-098 |
| scripts/tests/shared-convoy.test.cjs | 1 | INV-062 |
| scripts/tests/shared-merchant-rules.test.cjs | 8 | INV-027, INV-033 |
| scripts/tests/smart-loot.test.cjs | 5 | INV-062 |
| scripts/tests/solo-hunt.test.cjs | 11 | INV-092 |
| scripts/tests/stand-inspection.test.cjs | 19 | INV-009 |
| scripts/tests/starting-appearance.test.cjs | 2 | INV-063 |
| scripts/tests/upgrade-offering-recovery.test.cjs | 3 | INV-033, INV-074 |
| scripts/tests/upgrade-offerings-client.test.cjs | 9 | INV-031, INV-061, INV-077, INV-078 |
| scripts/tests/upgrade-offerings.test.cjs | 5 | INV-029, INV-031, INV-032, INV-033 |
| scripts/tests/upgrade-preview.test.cjs | 23 | INV-037, INV-062, INV-065, INV-067, INV-076, INV-104 |
| scripts/tests/upgrade-scroll-batch.test.cjs | 7 | INV-031, INV-062, INV-068, INV-078, INV-079 |
| scripts/tests/wtb-priority.test.cjs | 8 | INV-011, INV-098, INV-099 |

Behaviours with no mapped test (19): INV-001, INV-008, INV-018, INV-021, INV-024, INV-025, INV-035, INV-036, INV-052, INV-071, INV-072, INV-090, INV-091, INV-100, INV-105, INV-107, INV-108, INV-109, INV-111.

## 5. Needs your review

Each question gives Today, Options and a Recommendation. The coordinator copies them into REVIEW-QUEUE.md.

### Q1. How many stand slots should the console use?

**Today:** the console assumes 16 trade slots everywhere (runtime/coordinator/merchant/automatic-sales.ts:88
and 184, stand-marks.ts:107 and 152, characters/shared.js:9382, 9537 and 9559). The game gives a
merchant 24 slots at level 70 or with a `cstand`, and 30 at level 80
(game node/server_functions.js:4365-4376). A high-level merchant leaves up to 14 slots empty. The
fork does not change this.

**Options:**
- A. Read the slot count from the game rule (level and stand type). More listings and WTB offers.
- B. Keep 16 and leave the rest for the user to fill by hand.

**Recommendation:** A. It is a game-rule mismatch, not a design choice, and one helper replaces
seven copies of the number.

### Q2. Should the gold reserve bind every purchase?

**Today:** Ryan's bid jobs (stand bids, ALData bids, Ponty bids) spend merchant and bank gold with
no reserve (runtime/coordinator/commerce/bids.ts:93-103, 133-156, 185-202). The fork adds a gold
reserve that only its own watch and buy-now orders respect (fork HEAD
runtime/coordinator/commerce/npc-shop.ts:131-142), so a Ryan bid can spend below the reserve.

**Options:**
- A. One reserve for every automatic purchase, read by Ryan's bids and the fork's orders. The
  reserve means what it says; a bid can wait for gold.
- B. Reserve for the fork's orders only (today). Ryan's bids behave exactly as in his base.

**Recommendation:** A, offered to Ryan as a setting with a default of 0, so his base behaves the
same until a user sets it.

### Q3. What should happen to a native WTB offer whose slot empties without a receipt?

**Today:** the coordinator marks the offer blocked. A blocked offer that has a native id is
skipped by planning and never retried or removed, no new offer is placed for that item, and the
bid's purchase limit reads 0 while the offer exists (runtime/coordinator/commerce/native-stand.ts:76-79,
126-127, 144, 191; runtime/coordinator/http/native-stand.ts:100). The bid stalls until the user
clears it. The fork does not change this.

**Options:**
- A. After a confirmation window, drop the blocked offer from the ledger and let planning place a
  new one. Self-healing; a lost receipt can count one purchase short.
- B. Keep it blocked and show it on the dashboard with a "clear" button. Safe, needs the user.

**Recommendation:** A, with the dashboard notice from B, because a stalled bid looks like a
working one today.

### Q4. How should mail with an attachment get its postage?

**Today:** `merchantSendMail` sends without checking gold (characters/shared.js:10326-10380).
The game charges 360000 gold for mail with an item and 48000 without (game node/logic/mail.js:143).
With too little gold the send fails on the server.

**Options:**
- A. Withdraw the postage from the bank before sending, and fail the job with a clear message when
  the bank cannot cover it.
- B. Check gold and fail early, leaving the user to move gold.

**Recommendation:** A. The merchant already withdraws gold for other jobs
(`withdrawMerchantCash`, characters/shared.js:5911-5919).

## 6. Gaps

`node tools/check-claims.mjs` (run with `LIMIT=100000`), filtered to this spec:

- Functions claimed by this spec and by another spec: 0.
- Claims naming no known function: 0.
- Behaviours with no test: 19 (INV-001, INV-008, INV-018, INV-021, INV-024, INV-025, INV-035, INV-036, INV-052, INV-071, INV-072, INV-090, INV-091, INV-100, INV-105, INV-107, INV-108, INV-109, INV-111).
- Unclaimed functions across all specs: 3743 (the tool does not split these by spec; none of them is in this spec's proposed list).

Not yet verified:

- http/npc-sale.ts and http/anniversary-commerce.ts: function list only (not my behaviours; NPC sales are part B, anniversary is 06) (reader 10a).
- http/merchant-order.ts: read 39-70, 170-204, 231-312 only (crafting order build-up 72-169 and handle 213-230 not read) (reader 10a).
- dispatch-time Ponty replanning in merchant/dispatcher.ts and the character-side gold check (part B) (reader 10a).
- Test accuracy: no test in section 4 has been reviewed for whether it proves what its name says (method step 2).
- The test mapping is by file and test name; a test can prove more behaviours than the one it is mapped to.

## 7. Review claims checked

| Claim | Verdict | Evidence |
|---|---|---|
| Appendix A s0: only npc-shop.ts, npc-price.ts and stat-scroll-commands.ts differ in commerce/ and inventory/ | CONFIRMED | git diff refs/review/ryan-1.5 HEAD -- runtime/coordinator/inventory/stat-scroll-commands.ts shows only the statScrollName swap; npc-shop.ts and npc-price.ts exist only on HEAD |
| Appendix A s2: native-stand block 10 s retryAt added by 475fe2d2; two WTB fixes on 2026-09-30 | CONFIRMED | git log runtime/coordinator/commerce/native-stand.ts: 475fe2d2, 31dbf2e3 on 2026-09-30; native-stand.ts:76-79 |
| Appendix A s2: pruneProductionReceipts (2048 cap) added in cb8881f6 2026-10-07 | CONFIRMED | git log -L65,72:runtime/coordinator/inventory/production.ts -> cb8881f6 2026-10-07 Breene26; production.ts:65-72 |
| Appendix A s2: mailbox growth cap one day after the feature | CONFIRMED | 9454392e 2026-10-18, 198562f8 2026-10-19; mailbox.ts:6, 39 |
| Appendix A s3: stand bid jobs written at local-market.ts:104 only when merchantCurrent is null (:93) | CONFIRMED | local-market.ts:93-94, 104-111 |
| Appendix A s3: ALData bid jobs every 10 s via market-feeds.ts:74 -> aldata-service.ts:75 -> application.ts:1566 | PARTLY | market-feeds.ts:74 and aldata-service.ts:75 confirmed; the application hook is queueALDataMatches at application.ts:1427 on the Ryan ref (1566 is a HEAD line) |
| Appendix A s3: bid Ponty jobs have no realm and are replanned with the merchant's current server | PARTLY | bids.ts:105-116 sets no realm; purchase-composition.ts:27-33 passes the merchant's status server at queue time; dispatch-time replanning is in merchant/dispatcher.ts (part B) |
| Appendix A s3: homeRealm table (bids.ts:113, 147; manual-orders.ts:70, 118, 129; npc-shop.ts:416, 418) | CONFIRMED | bids.ts:113; manual-orders.ts:70, 118, 129; fork HEAD npc-shop.ts:416, 418 |
| Appendix A s3: marked/merchantMarked, withdrawals, compounds and bankboiQueue writer lists | PARTLY | all sites confirmed except automatic-action.ts lines, which sit one lower on the Ryan ref: 45 (not 46), 111 (not 112), 113 (not 114) |
| Appendix A s3: upgrades written at 19 sites in 13 files | PARTLY | sites confirmed; automatic-action.ts:52 (review says 53); offering-waits.ts:34-35 |
| Appendix A s3: merchantWeapon writers merchant-item-commands.ts:74, transfer-commands.ts:63, :80, clear-item-marks.ts:125 | CONFIRMED | same lines on the Ryan ref |
| Appendix A s3: bankboiTransaction single owner with four latches; ready within 10 s; recovery 600 s or 120 s plus stale or not banking | CONFIRMED | bankboi-service.ts:44-47, 49-58, 87, 102, 122, 141-147, 173 |
| Appendix A s3: production.attempts single owner; one unfinished attempt blocks all; 2048 cap | CONFIRMED | production.ts:65-72, 82, 91, 124, 187-202, 271 |
| Appendix A s4: npc-shop filters to activeRealm but stores listing realm and homeRealm at queue time | CONFIRMED | fork HEAD npc-shop.ts:357-360, 402, 416, 418 |
| Appendix A s4: watch select has no per-job cap | CONFIRMED | fork HEAD npc-shop.ts:383-395 |
| Appendix A s4: spendableGold subtracts only npcOrderId jobs; Ryan's bid jobs can spend below goldReserve | CONFIRMED | fork HEAD npc-shop.ts:131-142; bids.ts reads no reserve (inference only for the character-side check) |
| Appendix A s4: ponty.ts observe and refresh both call queueMatches, which runs queuePonty, matchPonty and scheduleRon | PARTLY | ponty.ts:51, 71 confirmed; the hook is fork HEAD application.ts:1556-1560 (review cites 1560-1564) |
| Appendix A s4: production prune present in Ryan's base; upstream #59 addressed at source | CONFIRMED | production.ts:65-72 called at :74, :132, :198; completed commerce journals stay inside the cap (:116-128) |
| Appendix A s4: string-matched errors (production.ts texts, 'interrupted', deconstruction text, one typed code) | PARTLY | production.ts:53-54, 82, 85, 249, 154 and bankboi-composition.ts:63, completion-retries.ts:72, merchant-idle.ts:50, withdrawal-bank-guard.ts:22 confirmed; the dispatcher log is at merchant/dispatcher.ts:261 on the Ryan ref (review says 265); http/marketplace-progress.ts:12-17 also has typed failure codes |
| Appendix A s4: 120 s window in six places; Ponty local freshness 30 s | PARTLY | bids.ts:101, 165; manual-orders.ts:111; price-history.ts:48; ponty.ts:56; fork npc-shop.ts:97 confirmed; also http/manual-market-orders.ts:52 and the unused helper runtime/market-preferences.ts:8-10; 30 s at ponty.ts:30, 34 and bids.ts:137 |
| Appendix A s4: magic timeouts list (native-stand 10 s, BankBoi 10/600/120/30 s, mailbox 30 s, delivery 10 s and 400 px, 3 slots, staging 35-41) | CONFIRMED | native-stand.ts:77; bankboi-composition.ts:63; bankboi-service.ts:54, 143, 144, 146; mailbox.ts:28; transfer-commands.ts:223-224; offering-waits.ts:132; reserved-cargo.ts:80 |
| Appendix A s4: direct Date.now() in native-stand.ts:77, merchant-item-commands.ts:101, production.ts:124, :187, transfer-commands.ts:223 | CONFIRMED | same lines; also native-stand.ts:127, mail-startup.ts:73, http/native-stand.ts:75, http/inventory-receipts.ts:83 |
| Appendix A s5: merchantQueue written from 19 sites in 10 files | PARTLY | sites confirmed; automatic-action.ts:101 (review says 102) |
| Appendix A s5: merchantCurrent flags set from outside (itemMarksCleared, offeringSupply, pauseReason) | PARTLY | automatic-action.ts:129, clear-item-marks.ts:74, offering-supply.ts:30 confirmed; pauseReason is at offering-waits.ts:64 and :133 (review says 67) |
| Appendix A s5: identity has no single definition; each legacy form keeps a branch | CONFIRMED | see problem 'Item and listing identity has many encodings'; more encodings exist than the review lists (stack identity, Ponty groupKey, name\|level, craft name@level) |
| Appendix A s6: live tip 21b8362d changes no file in commerce/ or inventory/ | CONFIRMED | not re-run; accepted from the review command git -C pta-pull diff af92de45 21b8362d --stat (no file in this slice differs between Ryan ref and HEAD except the three fork files) |
| Appendix B s4: luckySlotLocks set by merchant-settings.ts:52, removed by unlock and identity change | CONFIRMED | http/merchant-settings.ts:34, 52; status/lucky-slot-tracking.ts:21 |
| Appendix B s4: luckySlotResume set on unlock and released after a newer roll | CONFIRMED | http/merchant-settings.ts:42; status/lucky-slot-tracking.ts:44-51 |
| Appendix B s4: luckyUpgradeSlots has no runtime writer | CONFIRMED | git grep luckyUpgradeSlots on the Ryan ref: reads only, deletes at status/lucky-slot-tracking.ts:20, 27, and merchant/initial-runtime.ts:37-40 |
| Appendix B s4: lock, resume, verified precedence computed twice | PARTLY | three places: status/response.ts:134-140, characters/shared.js:11331-11333 (review cites HEAD 12054-12056), dashboard/features/party/connected-inventory.tsx:186; copies at shared.js:8471, 10471; fallback select at shared.js:5097-5098 |
| Appendix B s4: restoreBestEffort abandons the journal on lucky_slot_unavailable | CONFIRMED | runtime/characters/lucky-upgrade.ts:129-138 |
| Appendix B s4: completion-retries matches the exact 'item or scroll unavailable' sentence and treats other lucky texts as capacity | CONFIRMED | merchant/completion-retries.ts:67-73, 136; lucky-upgrade.ts:182 |
| Appendix B s4: the character already sends a typed code; the coordinator ignores it and parses English text | PARTLY | the code exists on the character's Error (lucky-upgrade.ts:67) and is used there (lucky-upgrade.ts:135, shared.js:3951); no errorCode field reaches the coordinator in the merchant completion path found by git grep, so the coordinator cannot read it (inference on the report shape) |
| Appendix B http rows: bankboi-storage second snapshot writer; in-memory dedupe of 32 receipts; 10 s error retry | CONFIRMED | http/bankboi-storage.ts:45, 47-51, 108, 117-120 |
| Appendix B http rows: manual-market-orders freshness and check flag (eb9acad0) | CONFIRMED | Ryan http/manual-market-orders.ts:50-57; fork HEAD adds allowStale through body.check === true (git diff) |
| Appendix B http rows: marketplace-location 25 px move threshold and one retry per seller | CONFIRMED | http/marketplace-location.ts:74-76, 116-119 |
| Appendix B http rows: restock compatibility comment, policy includes elixir | CONFIRMED | http/restock.ts:13, 29-42 |
| Brief: production.ts prune is part of ledger 15 (upstream #59) | CONFIRMED | production.ts:65-72 caps completed receipts at 2048 since cb8881f6; unfinished attempts are never pruned (:66) |
| evaluateAutoCompounds never fills completed and its filter is always true; callers still loop over completed (review 1.1 automatic-improvements.ts, improvement-scheduler.ts:142) | CONFIRMED | merchant/automatic-improvements.ts:40-54; improvement-scheduler.ts:140-147 |
| 16-slot stand capacity duplicated at automatic-sales.ts:88, :184 and stand-marks.ts:44 (review 1.1) | PARTLY | the literal is at automatic-sales.ts:88, :184 and stand-marks.ts:107, :152 (not :44; occupied() at :43-45 has no literal); also shared.js:9382, 9537, 9559; the game allows 24 or 30 (server_functions.js:4365-4376) |
| recoverSpace matches exact error text thrown at shared.js:9817 HEAD; magic SPACE_RETRY_MS 120000 (review 1.1 deconstruction.ts) | CONFIRMED | fork HEAD deconstruction.ts:92, 230-239; Ryan shared.js:9206 |
| retainBlocked matches exact error text, magic 300000 (review 1.1 npc-sales.ts) | CONFIRMED | merchant/npc-sales.ts:40, 45-50 |
| completedUpgrades has no caller (review 1.1 banked-improvements.ts) | CONFIRMED | banked-improvements.ts:56-58; not referenced in improvement-scheduler.ts or automatic-sales.ts read here |
| marketplace batching covers only ALData; Ponty jobs are never grouped (review 1.1 marketplace-batch.ts) | CONFIRMED | merchant/marketplace-batch.ts:17 |
| Global smart_move = bankSortMove; leaving a bank can throw 'Bank sort buffer cleanup pending; staying in bank' (Appendix C 0 and 4) | CONFIRMED | shared.js:32, 4305-4327, 4236-4237 |
| stockUp hard-codes hpot1 x 20 and checks six flags (Appendix C 1) | CONFIRMED | shared.js:3789-3792 |
| bankStoreFully: attempts < 50, staging 35-41, 2500 ms settle, throws bank_full (Appendix C 1) | CONFIRMED | shared.js:4070-4148 |
| bankboiCheckpoint throws 'bankboi_pending' matched by completion-retries.ts:41 (Appendix C 1) | CONFIRMED | shared.js:4160; completion-retries.ts:41 |
| consolidateCurrentBankFloor is a dead one-line wrapper (Appendix C 1) | PARTLY | shared.js:4372-4374 is a one-line wrapper but has a live caller at shared.js:4381; it is redundant, not dead |
| buyConfirmed polls 15000 ms with a 150 ms grace and recurses for non-stackables (Appendix C 1) | CONFIRMED | shared.js:4524-4553 |
| runBankboiService provision unequips every slot and sells every slot back to back; inventory sort swap() not awaited, 120 ms sleep (Appendix C 1, 2) | CONFIRMED | shared.js:4682-4688, 4763 |
| observedCompoundConfirmed and upgradeAtSlotConfirmed do not await the native promise (Appendix C 1) | CONFIRMED | shared.js:5044, 5201 |
| merchantMassBuff races use_skill against 750 ms; 20% MP rule (Appendix C 1) | CONFIRMED | shared.js:5161, 5168; the 20% rule applies only to the pp tier |
| trackedProductionWork failure regex /timed out\|uncertain\|interrupted\|recovery/ and 'Upgrade outcome uncertain' matched by uncertainUpgrade (Appendix C 1) | CONFIRMED | shared.js:5012, 5014; completion-retries.ts:113-118 |
| upgradeConfirmed bypasses tracking for a non-scroll<digit> scroll (Appendix C 1) | CONFIRMED | shared.js:5032-5033 |
| merchantImprove calls prepareUpgradeOffering twice per attempt and throws 'Auto compound made no inventory progress' (Appendix C 1) | CONFIRMED | shared.js:6229, 6249, 6388 |
| applyStatScrolls calls raw upgrade() with a 2500 ms poll as a second confirmation path (Appendix C 1) | CONFIRMED | shared.js:6641-6645; the window is shorter than the game's stat-scroll timer for grade 1-2 base items (server.js:7153-7160, 7498-7512) |
| prepareBankUpgrades: bank_retrieve then immediate findIndex with no settle wait (Appendix C 1) | CONFIRMED | shared.js:7259-7263 |
| merchantSelfImprove restore fallback 'highest level of the same name' and inventory_full for deferred withdrawals (Appendix C 1) | CONFIRMED | shared.js:7281-7290, 7362-7364 |
| merchantBuyUpgradeLine: batch cap 42, reserve 3, default 10000 attempts, '90%' budget text, legacyAllowance (Appendix C 1) | CONFIRMED | shared.js:7531, 7640-7661 |
| merchantCommerce two engines (version 2 vs legacy), journal sequence race, 35 px commerceMove guard, fixed 250 ms after split (Appendix C 1) | CONFIRMED | shared.js:7724-7727, 7745-7749, 7865, 8041-8045 |
| merchantExchange raw push_deferred and socket.emit('exchange_buy'); fixed 250 ms after split; exactInventoryQuantity duplicated (Appendix C 1, 2) | CONFIRMED | shared.js:8283, 8291-8296, 8359-8360; duplicate of 7937-7941 |
| merchantBankErrands one HTTP checkpoint per marked item and 'bank_full' string match (Appendix C 1) | CONFIRMED | shared.js:5927-5933, 6009 |
| keepTracktrixLast thirteen-flag guard (Appendix C 1) | CONFIRMED | shared.js:5630-5633 |
| findUpgradeMarkSlot throws 'Upgrade inventory recovery ambiguous:' matched by completion-retries.ts:124 (Appendix C 1) | CONFIRMED | shared.js:6086; completion-retries.ts:124 |
| Magic windows: waitForMarkedItem 2000, settleBankSortSwap 5000, buyConfirmed 15000, bank confirm 5000, waitForBankPack 10000, upgrade 30000/1500, mass buff 750, split 250 (Appendix C 4) | CONFIRMED | shared.js:3826, 4266, 4539, 4600, 4616, 1918, 5204, 5226, 5168, 7865, 8283 |
| Typed failureKind only for hunt_movement_owned, commerce_movement and commerce_recovery (Appendix C 4) | CONFIRMED | shared.js:8218 (merchantCommerce); merchantService line not in this list |
| Fix-on-fix: merchantBuyUpgradeLine remap fixes fde2186d, 2be25ed8, 6f532e38; lucky best effort 17400329 (Appendix C 3) | CONFIRMED | git log -1 of each sha (dates 2026-10-09, 2026-10-09, 2026-10-18, 2026-10-10) |
| Identity encodings: fingerprint/sameItem, sameItemState, bankStackIdentity (9 fields), bankSortItemState, '@+' rule keys, JSON fingerprint comparisons (Appendix C 4) | CONFIRMED | shared.js:1241-1263, 4019-4023, 4261-4263; also stand-marks.ts:27-35 identity and Ponty exactProperties shared.js:8599-8604 |
| 6.2: stand reconcile up to 16 unequips with no delay, 144 for a full reprice | PARTLY | shared.js:9537-9550 confirms 16 back-to-back unequips (Ryan line, review cites HEAD 10231-10245); 144 is the review's estimate from CC unequip 6 (server.js:248-262), not measured |
| 6.2: retrieveFromBankUntil loop up to 100 with no settle wait; ALData sell loop with no wait | CONFIRMED | shared.js:1336-1345, 8983-8987 |
| 1.2: merchantDeconstruct throws the exact text the coordinator matches (vs deconstruction.ts:233) | CONFIRMED | shared.js:9206; deconstruction.ts:233 exists only at fork HEAD |
| 1.2: merchantDonate raw parent.socket.emit('lostandfound') | CONFIRMED | shared.js:9297 |
| 1.2: merchantCatalog hard-coded upgrade chance table copied from game data | CONFIRMED | shared.js:2235-2239 equals game design/upgrades.js upgrades igrade 0-2 |
| 1.2: guardedMarketPurchase two HTTP calls per purchase | PARTLY | shared.js:9393-9406 makes at least three: the nativeStandSync report (one or more), the purchase request, and the receipt flush |
| 1.2: consolidateMerchantInventory 7 flags guard one swap | CONFIRMED | shared.js:9410-9411 |

## 8. Settings index

| Setting | Default | Read at | Written at |
|---|---|---|---|
| standBids[item] | none | commerce/bids.ts:62-65, 140, 194; commerce/local-market.ts:67; commerce/native-stand.ts:37-47; commerce/public-listings.ts:72 | http/merchant-bid.ts:82-87, 126; commerce/bids.ts:72-74; commerce/native-stand.ts:60-61 |
| merchantAutomations['stand bid purchases'] | on (absent) | commerce/bids.ts:135, 186; commerce/local-market.ts:93 | merchant settings routes (part B) |
| autoStandBuys | off | commerce/native-stand.ts:44 | http/native-stand.ts:63-66 |
| merchantBlacklist / autoBlacklistMerchants | {} / on | application.ts:1439; commerce/purchase-progress.ts:87-88 | http/merchant-blacklist.ts:31, 50-54; commerce/merchant-blacklist.ts:37 |
| aldata.key / aldata.auth | '' / 'NO' | commerce/aldata-service.ts:102; status/composition.ts:106 | http/aldata.ts:40-43, 58; commerce/initial-aldata.ts:20-21 |
| env AL_DATA_URL | https://aldata.earthiverse.ca | application.ts:1356; commerce/market-feeds.ts:36 |  |
| marketIgnoredItems | [] | dashboard market views (not traced) | http/market-ignored-items.ts:7-16 |
| mailbox.settings.autoCollect / autoDelete | false / false | commerce/mailbox.ts:28-29 | commerce/mailbox.ts:37 |
| restockPolicies[name] | hp hpot1 5-20, mp mpot1 0-0 | inventory/storage-service.ts:62-72; application.ts:519-528 | http/restock.ts:42 |
| autoItemMarks[owner][name@+L] | {} | inventory/collection-marks.ts:47-49; inventory/withdrawal-bank-guard.ts:19-20 | inventory/mark-commands.ts:36-62; inventory/automatic-action.ts:42-43; inventory/clear-item-marks.ts:98-100; inventory/shared-rules.ts:66 |
| autoUpgradeMarks[owner][name@+L] | {} | inventory/upgrade-marks.ts:97; inventory/production.ts:36; inventory/offering-supply.ts:69 | inventory/upgrade-commands.ts:103, 107, 147-148; inventory/production.ts:235; inventory/compound-commands.ts:149; inventory/clear-item-marks.ts:82 |
| autoCompounds[owner] | {} | inventory/production.ts:46; runtime/compound-storage.ts:9 | inventory/compound-commands.ts:130-138, 156; inventory/automatic-action.ts:58; inventory/clear-item-marks.ts:106 |
| autoExchanges[name@L] | {} | inventory/automatic-action.ts:145 | inventory/merchant-item-commands.ts:85-88; inventory/automatic-action.ts:100; inventory/clear-item-marks.ts:123 |
| upgradeOfferingRules | [] | inventory/offering-supply.ts:65; inventory/production.ts:255 | inventory/upgrade-offerings.ts:22, 30 |
| goldTargets[name] | none | inventory/bank-queue.ts:41-43 | inventory/upgrade-commands.ts:167 |
| merchantRules | null | inventory/shared-rules.ts:20-25 | inventory/shared-rules.ts:77, 91 |
| merchantWeapon | null | characters/shared.js gathering restore (part B) | inventory/merchant-item-commands.ts:74; inventory/transfer-commands.ts:63, 80; inventory/clear-item-marks.ts:125 |
| statScrolls[name] | {} | inventory/stat-scroll-commands.ts:107 | inventory/stat-scroll-commands.ts:111-123; http/inventory-receipts.ts:47 |
| luckySlotLocks / luckySlotResume / luckyUpgradeSlots | {} | status/response.ts:136-139; characters/shared.js:11331-11333 | http/merchant-settings.ts:34-53; status/lucky-slot-tracking.ts:19-29, 47 |
| threshold / itemCollectionThreshold / buyUpgradeBatchSize | 100000 / 1 / 1 | merchant collection scheduling (part B) | inventory/initial-collection.ts:27-32 |
| npcShop.settings.goldReserve / ronDonation / ronVisitMinutes (fork) | 0 / false / 10 | fork HEAD npc-shop.ts:131-142, 466-470, 479-481 | fork HEAD npc-shop.ts:333-348 |
| bankSortMode | automatic | runtime/coordinator/merchant/bank-sort.ts:26, 108-110; characters/shared.js:4181-4182 | runtime/coordinator/merchant/bank-sort.ts:87 |
| bankSortRequest | null | runtime/coordinator/merchant/bank-sort.ts:27, 53, 77, 110 | runtime/coordinator/merchant/bank-sort.ts:63, 88-90 |
| bankSortLayout (fork) | packed | fork HEAD bank-sort.ts:31, 100; fork HEAD shared.js:4619 | fork HEAD bank-sort.ts:92 |
| itemCollectionThreshold | 10 | runtime/coordinator/merchant/bank-collection.ts:28; runtime/coordinator/merchant/automatic-sales.ts:138 | runtime/coordinator/http/thresholds.ts (cite only) |
| buyUpgradeBatchSize | 1 (range 1-42) | characters/shared.js:7645 | runtime/coordinator/http/thresholds.ts:34 |
| merchantAutomations['auto npc sales'] | on (undefined) | automatic-sales.ts:123, 207, 231; bank-collection.ts:18; player-npc-sales.ts:159 | merchant settings routes (spec 11) |
| merchantAutomations.withdrawals / ['party collection'] | on | bank-collection.ts:27-28 | merchant settings routes (spec 11) |
| merchantAutomations['auto compound'] / ['auto upgrade'] / ['automatic exchange'] | on | improvement-scheduler.ts:98, 138, 163 | merchant settings routes (spec 11) |
| autoNpcSales | {} | automatic-sales.ts:49, 122, 221; npc-sale-keep.ts:14; player-npc-sales.ts:180 | http/automatic-sales.ts (cite only) |
| autoStandMarks | {} | automatic-sales.ts:91, 122 | http routes (cite only) |
| standBids | {} (useStandSlot false, acceptHigherLevels true) | automatic-sales.ts:88, 183; stand-marks.ts:44; initial-state.ts:126-129 | http/merchant-bid.ts (cite only) |
| autoCompounds | {} | improvement-scheduler.ts:73; banked-improvements.ts:26 | improvement-scheduler.ts:141 (writes the same rules back) |
| autoUpgradeMarks | {} | banked-improvements.ts:40 | http routes (cite only) |
| autoExchanges | {} | improvement-scheduler.ts:89 | http routes (cite only) |
| autoDeconstruction | {} | deconstruction.ts:143 | deconstruction.ts:302-321 |
| upgradePreviewResults | {} (cap 100) | upgrade-preview.ts:18, 26 | upgrade-preview.ts:53-55 |
| merchantGoldTarget (character merchantCashTarget) | 0 | characters/shared.js:5912-5913 | characters/shared.js:11340 (status handler) |
| luckyUpgradeSlot | null | characters/shared.js:5097, 5144 | characters/shared.js status handler (spec 08/11, cite only) |

## The design

M1.

## What changes for the player

M1.

## Proof

M1.

## Migration

M1.
