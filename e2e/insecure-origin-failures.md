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

## ALData key copy

The Copy key button calls `navigator.clipboard.writeText`, and `navigator.clipboard` is
also secure-context only. Same journey file, second test.

5. **Nothing copied.** On the LAN origin the click throws (`navigator.clipboard` is
   undefined) and the clipboard keeps its previous contents.
6. **Silent failure.** When copying is impossible, the page says nothing; the key must
   instead be offered for manual copying.
7. **Wrong text.** The copied text differs from the stored key.
8. **Secure contexts changed.** HTTPS and `localhost` stop using the Clipboard API.
