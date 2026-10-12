# Map capture boundary failure inventory

Before changing the regression:
- Three canvas capture journeys must keep pixel identity and coordinate footer checks.
- Dashboard polling interception may still have requests in flight when the fixture shuts down; drain routes before teardown.
- The external image fetch must not inherit canvas/polling setup or consume its remaining deadline.
- The fixed-origin image endpoint must still return genuine image bytes and reject external origins.
- A failed upstream request must remain a failure, not become a skipped or mocked success.

Run: `npm run test:e2e:console -- --grep "expanded character and Cave maps|fixed-origin map image proxy"`.
