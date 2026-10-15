# Manual offering rules and batch supply

Failure inventory recorded before implementation:

- Ordinary manual and equipped marks bypass required and optional durable rules.
- A current-level rule edit or explicit one-attempt override is ignored.
- Menus omit sprites, optional parentheses, affected steps or scroll-cost meaning.
- +8 wand batches request only one stack and cycle between upgrade and bank work.
- Queued remote stock or a native deposit is mistaken for carried delivery.
- Storage yields lose original targets, survivors or marks; restart duplicates requests.
- Protected stacks or insufficient capacity bypass existing storage guards.
- Optional absence differs from a failed retrieval and hides the latter.

Native scenarios use offline BankBoi inventory as declared initial input; native
deposits, collection and upgrade outcomes must remain real. Console scenarios
retain screenshots and requests. No production activation is authorized.

The RED ordinary-manual native +8 wand journey rolled both wands while leaving
all three Primlings unconsumed. The actual storage path deposited the worker's
three stacks, restored the merchant, and resumed upgrades; evidence snapshot is
`.build/offering-before-scheduling.json`. The initial concurrent console attempt
collided with the native fixture's dev-server lock and damaged its shared report;
that historical report is not a passing or integrity-verified native result.
Subsequent E2E runs are sequential.

The console offering pixels use the unmodified native pack_20vt8.png sheet from
the disposable pinned upstream server, with positions from the pinned 17175 game
fixture. SHA-256: be044f990ad88e0fcdd2c4bdb63e95a8586a0ab08f8537e14288c03726cf71ee.
The fixture embeds that sheet as a data URL so screenshots require no external
network. Browser checks decode the actual sprite image before capturing it.
Validation evidence retained so far:

- All six real +8 wand batch cases passed: ordinary manual and automatic work,
  each uninterrupted, interrupted during storage handoff, and interrupted after
  delivery. They observed the persisted supply dependency and verified exactly
  two offerings consumed, actual merchant delivery, and no unfinished +8 copies.
- Both console menu scenarios passed with native sprite pixels, screenshots,
  scroll prices and submitted durable-rule requests.
- Forty retained offering, production and storage checks passed; the 24 recovery
  checks were repeated after the completed-journal continuation fix and passed.
- TypeScript checking and scoped runtime lint passed. Repository-wide runtime
  lint retains unrelated baseline failures.
- The first stock-boundary run exposed test-fixture bank access errors outside
  the native bank. Those results are retained as failures and are not counted as
  passing behavior evidence; the corrected fixture reads persisted native stock.

Final verification:

- All eleven distinct native scenarios have passing evidence across retained
  runs: six +8 wand batch/restart journeys and the five stock boundaries.
  The final game generation 154aa5162a01 additionally passed the manual +8 batch,
  carried stock, optional absence, protected stock, native bank collection, and
  required absence/restart/rule edit. Restart rule edits wait for the real item
  catalog to become available; seeded native bank stock is reported through the
  existing checkpoint endpoint from the actual native database observation.
- Both supply-contract console scenarios passed in the private workspace
  `.build/offering-console-isolated/`, using identical maintained sources and
  copied compiled artifacts. This avoided another session's dashboard lock.
  They verified manual/automatic batch demand, ownership/intent rejection,
  withdrawal deduplication, restart retention and blocked worker behavior.
  Their passing report was copied to `.build/e2e-report/` and results to
  `.build/e2e-results/`; the artifact verifier passed for all 21 evidence files.
- Native evidence archives: `.build/offering-batch-stock-fixture-report/`
  records six passing batch cases and five original fixture failures;
  `.build/offering-final-code-fixture-report/` records the passing final-source
  batch/carried/optional/protected cases alongside four fixture failures;
  `.build/offering-native-stock-with-console-fixture-failures-report/` records
  passing native-bank and required-absence cases alongside two console fixture
  failures. These mixed suites are explicitly failed, not aggregate passing
  reports. Their selected native outcomes are retained in the evidence ledgers.
- Console menu screenshots were visually inspected. Native offering sprites,
  required/optional step labels, white panels and black text are readable.
- The two final console cases ran through `npm --ignore-scripts test` using the
  already verified game generation after repeated background build-lock and
  separate E2E server contention. The prior full `npm test` runs performed the
  TypeScript and asset builds; application source did not change between them.
- Completed immutable candidate: 14e04bbe1e32770f1354c4068f50e6703b97e8426aa558bb709f2542e94946cd.
  Verified source fingerprint: 78244240c78cecc5ebef854a7910131ccc81f71d4b904e40fadc3e26d467a1cc.
  Active build remains f375b5778721fa68473a3d445838ad6149e07e1dcac477f18230025e9304ca84.
  No deployment or activation was performed. Activation requires the supported
  full restart because character, coordinator and dashboard code all change.

Follow-up failure inventory (live GoldMajesty loop): BankBoi-only upgrade inputs
are counted as immediately runnable bank work while existing withdrawals prevent
staging them. Empty automatic jobs repeatedly complete and redispatch, starving
the storage slot needed by an unrelated required Primling dependency. The live
worker also retained a network checkpoint error, which must stay visible.
Regression: combine ordinary +8 wand offering demand with an unrelated
BankBoi-only helmet upgrade; never admit its upgrade visit before native stock
exists, and verify real offering delivery and consumption through storage.

The same regression starts the worker with the reported checkpoint network error
and an expired retry time. The storage planner must classify that communication
failure as retryable while retaining native receipt/journal recovery safeguards.

Follow-up verification: the original remote-input scenario failed because an
upgrade visit was admitted while its only input remained in BankBoi. Evidence
is retained in `.build/offering-remote-upgrade-red-results/` and the corresponding
report. A subsequent check used the internal `bankSnapshot` field against the
public state API; corrected the scenario to inspect the public `bank` field.
The worker now retries expired checkpoint network errors, and automatic bank
upgrade admission requires carried or native-bank stock. Typechecking and all
43 retained offering/storage scheduler regressions passed.
Completed immutable production candidate:
`adb4452d863d33e78368bc767ff72a57ef72fa027740424a925f816200781790`.
All four changed production files match the completed candidate. No activation
or live restart was performed; active build remains `14e04bbe1e32770f1354c4068f50e6703b97e8426aa558bb709f2542e94946cd`.
The corrected native remote-input regression passed (1 scenario). It verifies
recovery of the expired checkpoint communication error, BankBoi handoff, native
stock admission, merchant delivery, and consumption of two Primlings for two
+8 wand attempts. The artifact verifier passed: 34 evidence files. Retained
passing report/results: `.build/offering-remote-upgrade-green-report/` and
`.build/offering-remote-upgrade-green-results/`.
The final E2E typecheck passed. A repeated full typecheck was blocked by two
concurrent, unrelated optional-usage errors in gear-comparison-dialog.tsx.
