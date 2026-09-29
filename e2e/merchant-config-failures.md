# Merchant configuration regression boundaries

Recorded before implementation:
- Fresh config and journal have no designated merchant; a real owned merchant login must enable its controls and jobs without a manual API call.
- Non-merchant reports, unassigned characters and bankboi workers must not become the merchant.
- An existing assignment must survive subsequent reports and coordinator restart; additional merchants must not silently replace it.
- Identification must happen before consuming the first merchant catalogs, Ponty observations and job reports.
- Merchant UI must use the actual configured name in Live WTB, Ponty purchase, bank floor/vault unlock and donation descriptions. Missing assignments need generic text.
- Opening/cancelling confirmations must not queue purchases, unlocks or donations.

The native journey uses the real game, CODE reports, coordinator persistence, browser UI and native bank visit. Console dialog coverage uses declared bank/Ponty observations only; it does not claim to execute economic operations. Both retain traces, screenshots and checksummed state evidence.
