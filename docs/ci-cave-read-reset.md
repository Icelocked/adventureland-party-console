# Idempotent Cave observation connection reset

Before editing the fixture, run 38290198803 shard 1 failed at the ready observation
GET `/party-api/daily-dungeons` with `ECONNRESET`. It was not an HTTP failure or
an unsuccessful readiness result. The retained final state was successfully read
from the same coordinator afterward. Its log shows normal teardown, with no
preceding runtime exception.

The three read-only Cave observation helpers may use Playwright's bounded
`maxRetries: 1`, which retries only `ECONNRESET`. Preserve their existing readiness
and arrival poll deadlines. Do not retry POST commands, HTTP error responses,
native movement failures, game errors, or unmet behavior assertions. A persistent
reset still fails after that one retry, so a crashed host remains observable.
