# Native Cave encounter sequencing

Failure inventory before editing the fixture:

- Physical arrival at Lockbreaker's room does not prove its boss died or the native room completed.
- Creating an artificial next encounter immediately opens a new vote while the live boss remains engaged. Native choice ownership then changes, leaving that old boss retained ahead of the duel.
- Do not manufacture boss deaths or completion; wait for actual native enemy defeat and room.done before adding the next test encounter.
- Preserve the existing native duel's chosen ally survival/rival death assertions and retain boss completion evidence.

Run38216828516 shard1 reached Lockbreaker successfully but recorded only three nonlethal boss hits before creating the artificial duel. Target580 remained engaged while rival614 waited. The fixture must match normal sequential encounter progression.
