# Realm arrival uses bounded verified progress

Failure inventory before code:755 native shard16 operation failed at60s with W and merchant verified destination arrivals, while Priest completed native reconnection75s after admission. The independent Steam handoff was still progressing. Realm failure let merchant home routing resume before group handoff completed.

Exercise the observed sequential20/40/75s destination arrivals, old timestamps/wrong realms never renewing progress, the unchanged60s no-progress failure, only one renewal per distinct participant, a hard participant-count cap, and replaced operation never activating or clearing successor work. Final success still requires every participant currently reporting the exact destination with fresh post-admission observations; previously seen arrivals alone do not count.

Do not increase the native E2E120s assertion or accept a stale destination report. CPU fixture improvements may shorten reconnect, but cannot replace ownership and bounded-progress semantics.
