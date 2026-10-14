# Native farming handoff area contract

Failure inventory recorded before changing the scenario:

- A raw `/travel` point uses the configured search radius, while an automatically
  selected farming polygon has a different arrival boundary. Checking the latter
  after requesting the former can reject a successful, intentional combat handoff.
- Run 38544439766 shard 8 recorded dozens of real attacks by both fighters. The
  priest's default +100 weapon gave it 483 range, allowing sustained combat outside
  the polygon whose physical-entry timestamp gated all counted hits.
- Request a catalog-validated Sparkbot farming area using the same navigation API
  as the dashboard. Keep the accepted destination immutable in the assertion.
- Use existing native `combat-range` equipment, without changing server stats,
  geometry, movement, damage, or combat outcomes. Keep the 120-second deadline,
  physical entry with the existing 150-unit margin, and post-entry native hits.
- Record raw hits separately from post-arrival hits so a failed arrival assertion
  cannot be misread as a lack of combat. Preserve nearby Targetron selection.

Run and verify:

```
npm run test:e2e:live -- --workers=1 --grep "native UHills farming handoff reaches terrain-safe combat for both fighters"
npm run test:e2e:verify
```

The exact native scenario passed locally in 12.2 seconds (1.8 minutes including
fixture lifecycle), with 60 verified evidence files retained under
`.build/farming-area-passing/`. Both fighters physically entered the accepted
area and delivered positive native damage after their recorded arrival.
