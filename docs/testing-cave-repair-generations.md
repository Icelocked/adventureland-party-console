# Cave travel repair generations

Run 38327635916 recorded farm arrival under serial 5, followed by boss assembly serial 6. The priest's owned movement then reported a native planning timeout. The coordinator repaired the unchanged Lockbreaker destination to serial 7 with `repairs: 1`; both exact successor move commands and native travel IDs were active. The test continued waiting for serial 6. The failed dungeon receipt had already been superseded, so it is not claimed as retained evidence; the native movement failure was recorded.

Follow only a serial increment that exactly matches a positive, bounded repair-counter increment, on the same active run, floor, and complete movement destination. Both fresh, alive actors must report the exact successor commands and travel IDs. Reject unrelated restarts, changed targets, unknown or reset counters, new floors, and stale ownership. Record every adopted generation and observed receipt.

Boss and farm waits share this guard. For farm repairs, clear only generation-specific arrival evidence and keep the original acceptance timestamp, allowing a genuine successor packet received just before adoption. Keep the existing 300-second dispatch and 600-second arrival budgets, radii, native combat outcomes, and required-room checks unchanged.
