# Continuous return fixture Town availability inventory

Validation run 38314036554 exposed two walking-only fixtures that reported both
`returnTownReady` and native `can_use` as true despite `disableTown=true`.
After a map transition, the return policy legitimately reconsidered Town.

Preserve the strict zero-Town-use assertion by declaring Town unavailable in
both the status and native precondition for those walking-only cases. Other
skills stay available, and Town-eligible cases remain unchanged. All member
arrival, barrier identity and elapsed-time assertions remain. Stable availability
now requires exactly one route version and epoch, with no replacement commands
in either mode. All five retained cases pass; no production behavior is changed.
