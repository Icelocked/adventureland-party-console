# Exchange pickup acknowledgement

Before editing the fixture, native run 38282332581 shard 8 failed its immediate
queue assertion after the dashboard menu click. Artifact 11764167130 shows the
actual final queue contains the matching `exchange` job and `exchange pickup`
job, with one armorbox requested and the merchant held at its stand. The click
completed before its asynchronous HTTP mutation was reflected in that first
snapshot.

Failure modes: mutation never acknowledged, pickup and exchange IDs differ,
pending intent lost during restart, unauthorized unlocked stock consumed,
locked/unrelated stock changed, or no actual native exchange reward. Wait for
the real matching persisted pair, retain its IDs, verify that exact pair after
restart, and keep the existing native transfer/reward/conservation checks.
