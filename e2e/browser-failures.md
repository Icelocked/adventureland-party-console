# Browser failure modes (written before the specs)

Account preference journey, using the real browser, dashboard gateway, coordinator and persistence:

- Settings cannot open or the offline account cannot edit its BankBoi name.
- Invalid short prefixes reach the real validation route but are accepted or mutate persisted settings.
- A rejected save loses its draft, hides the server explanation, or prevents a corrected retry.
- A successful save reports success without sending the selected value through the gateway.
- Reload loses the setting because the UI only changed local state.
- Coordinator restart loses the setting because it was not persisted.
- A subsequent invalid save overwrites the last valid setting.

Evidence: capture actual HTTP statuses and JSON request/response bodies, before/after coordinator state, and a screenshot after reload and restart. The test must be repeatable with a fresh isolated service stack; it must not replace dashboard/coordinator responses or launch game workers (blocking external network is allowed).

Context menu journey: real right-click must open an opaque white menu with black text; hover must open a white submenu; upgrade preview must be readable and opening it must not enqueue an upgrade. The fixture supplies a real status observation for merchant M holding Sword at slot zero. Read-only preview POSTs must all carry refresh=false. An offline roster or catalog-only fixture does not exercise this path, so no fake component/response substitute is acceptable. Capture computed colors normalized to RGBA for hover, screenshot, preview HTTP requests/response, and before/after state.


Hunt controls journey failure modes (before implementing the spec):

- Selecting Hunt without a saved backup skips the required selection, or loses the chosen backup on submission.
- A farming-mode request targets the wrong character or never reaches the real coordinator.
- Hunt setting changes disappear when modes change or the dashboard reloads.
- Leaving Hunt leaves the character profile active in Hunt or keeps Hunt-owned command intent.
- Follower settings leak into the selected leader profile.
- UI displays a selected Hunt mode without the coordinator accepting it.

Use the W card, real farming selection/settings controls, and real HTTP/state evidence. Assert saved mode and settings, plus observable Hunt state cancellation where exposed. This does not prove game movement, quest completion, or reward claims; those require actual game execution beyond the simulated status boundary.
