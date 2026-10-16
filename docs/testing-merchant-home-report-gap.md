# Merchant home report gaps

The focused native capacity test observed an unexpected page restart while the merchant was already on US I. Its log recorded home-realm recovery after the stand opened and its command completed. Recovery demanded a report newer than three seconds and immediately restarted a new realm request when a short report gap exceeded that limit.

Before implementation, retained regressions cover a live, connected merchant whose block and last observed realm both match home. A report gap must hold work without creating a realm request or login operation; a fresh report resumes work. At fifteen seconds without a report, existing restart and sixty-second arrival/retry behavior remain. Wrong realm, disconnected or exited worker, disconnected native socket, death, missing health/report, and future timestamps must not imply healthy arrival.

Headless liveness uses the existing connected CharacterBlock and live child process; native liveness uses selected Steam membership and actual socket-connected travel observations. The grace period is measured from coordinator report receipt, with no new timer or durable state. Native E2E still needs to verify the complete gathering journey.
