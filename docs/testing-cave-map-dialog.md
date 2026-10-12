# Cave map dialog accessible-name regression

Failure inventory before implementation:

- A resolved encounter closes while the full Cave map remains open; dynamic dialog title registration can leave its accessible name missing.
- The visible Add waypoint control then cannot be reached through the named dialog locator, even though it is enabled.
- A floor update must update the accessible name rather than retain the prior floor.
- A fix must retain native freshness, waypoint acceptance, and movement assertions; no forced clicks or blanket timeout retries.

Validation: run the native Cave entry scenario in e2e/live-cave.spec.ts. It opens the named map after a native encounter, selects Add waypoint, submits via UI, and verifies both native character movements. The retained screenshot and trace expose the accessible dialog name.

Focused CI run 38209706477 confirmed the explicit accessible name resolves the correct enabled button. Its trace records 567ms to resolve the locator and only 422ms remaining for visibility/enabled/stability animation-frame checks. No encounter dialog obstruction was reported. The one-second override is below the existing ten-second native UI freshness acknowledgement window; use that bounded window for the click too. Retain all actionability checks, native acceptance and movement assertions.
