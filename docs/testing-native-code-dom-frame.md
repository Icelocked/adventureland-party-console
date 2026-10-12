# Current native CODE frame readiness

The Targetron native test failed during read-only CODE preflight after its existing 30-second retry window. The mutation had not run. The old helper scanned child frames by name or URL; the native game instead addresses its current CODE iframe through `#maincode` in the DOM.

Resolve that iframe's current content frame and reject detached or missing frames inside the existing read-only preflight. Keep the 30-second deadline and evaluate potentially mutating expressions exactly once outside the retry. Do not replay mutations, invent readiness, or suppress unrelated errors. Native E2E must verify this authority correction; the detached frame alone does not prove that it resolves every replacement failure.
