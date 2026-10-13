# Boo Boo native Town cooldown setter gate

Focused run 38306471306 failed the one-time declared 600-second client cooldown verification before walking. Native `js/functions.js:5527` shows that `skill_timeout` delegates only for skills with shared or configured cooldowns, or attack. Town has none, so the wrapper does nothing.

The maintained `skill_timeout_singular` setter at line 5478 writes `next_skill[name] = future_ms(ms)` using the real clock and queues standard UI tint updates. Use it once. Retain the actual expiry and readiness assertions; do not remove the 590-second check, synthesize server rejection, refresh cooldowns or change skill definitions.
