# Native economy completion and batch capture failure inventory

- CODE restart can requeue a commerce intent under a new dispatch ID. Observing disappearance of the old dispatch alone falsely reports completion while the same commerceOrderId remains queued. The completion observer must fence both identities.
- The ten-coat purchase batch reached paid sequence 27 at the 120-second capture deadline after real funding, travel and purchases. The first pending upgrade checkpoint had not started yet. Retain exact ten-base/one-existing-target assertions and allow a bounded four-minute capture window, with six minutes total for cleanup.
- Preserve native operation/result/spending assertions and validate these existing journeys in native CI; do not fabricate completion or disable recovery.
