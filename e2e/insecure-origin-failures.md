# Cave entry from a plain-HTTP origin: failure inventory

Written before the change (2026-10-13, Cave of Many Dreams settings → Enter now showed
"crypto.randomUUID is not a function"). Browsers expose `crypto.randomUUID` only in
secure contexts (HTTPS, `localhost`, loopback IPs). A console opened over plain HTTP by
LAN address or hostname is not one, and `dungeon-query.ts` builds every Cave action's
`operationId` with it. Live journey: `e2e/live-cave-insecure-origin.spec.ts`.

1. **Action never sent.** Enter now (and every other Cave action: settings, progress,
   exit, retry, recover) throws before the request, so nothing reaches the coordinator.
2. **Invalid identity.** A replacement ID is empty, longer than 160 characters or not a
   string, and the coordinator rejects it ("An operation ID is required").
3. **Repeated identity.** Two actions reuse one ID, and the coordinator silently treats
   the second as already done (`operations.includes(id)`).
4. **Secure contexts changed.** HTTPS and `localhost` consoles stop using
   `crypto.randomUUID`.
