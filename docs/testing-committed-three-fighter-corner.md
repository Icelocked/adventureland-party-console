# Committed three-fighter corner recovery: pre-code failure inventory

Observed live after artifact759 deployment: Warrior keeps attacking/kiting the committed red Sparkbot while Mage and Priest repeatedly report formation-blocked/no safe local detour. Source peaceful collective terrain recovery rejects engaged target/unfinished fight; this is intentional and must remain. Moving healer/target anchors more than12 units may repeatedly invalidate individual incremental search, but saved reports do not prove those resets occurred. Current live state no longer contains that encounter; never recreate it in the user's live world.

## Native scenario requirements

- Use actual Warrior, Priest, Mage AND Merchant clients. Declare the fourth class/loadout before native login; do not fabricate a role or status.
- Exact committed same realm/map/instance target stays owned, with native Warrior damage proving red combat before recovery.
- Put caster and healer around a native collision corner using connected, native-clear staging paths; retain map/base/geometry and exact positions. No coordinate teleport during combat.
- Warrior remains able to fight. Mage and Priest must make observed native-clear physical progress, then deliver native damage/healing while the same red target persists.
- Pending phase2 (not implemented by the initial baseline): move the native target/healer along a native-clear short route more than12 units while incremental recovery is pending, verifying retained progress without unsafe/stale route continuation. The initial baseline first verifies actual four-client admission and committed three-fighter recovery, retaining natural caster/healer movement for analysis.
- Preserve healing coverage and secondary-monster safety. An individual path may not cross another monster's danger radius or authorize an unrelated collective peaceful regroup.

## Failure cases

Wrong role due primaryClass replacing Warrior rather than adding Mage; fourth native admission failure; stale/invisible peer or detached CODE; false progress from intent alone; unsafe staging point/segment; old target or changed runtime/epoch accepted; target death/warp masquerading as recovery; healer moves repeatedly resetting pending search; stale healer goal followed after identity changes; withheld movement despite an available safe route; enemy/party separation safety ignored; movement overwrites convoy/dungeon/manual ownership; premature resumed attack before actual range/coverage; snapshot sampling misses real movement; native line violation/Jail; outcome tests replace native combat; added graphics flag changes hitboxes; fixture default roster changes other tests.

## Fixture architecture

Bootstrap already creates disconnected E2EBankBoi. Default-off extraFighter:'mage' can seed its actual native class/gear before login and launch it normally as fourth client. Retain the original three-client default and Merchant. Extend startup and native stat evidence loops only for this explicit option. Verify four-client native admission through E2E, not mocked account/connection flags. Existing other-session fixture files must remain untouched.
