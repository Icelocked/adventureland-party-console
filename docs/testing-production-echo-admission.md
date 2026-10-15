# Production echo completion identity

The existing native E2E case can mistake an accepted, queued order for a completed order: the queue initially identifies it by `id`, while `commerceOrderId` is assigned later. The failed run recorded zero storage echoes and an order still processing its first attempt.

Completion must require both identity forms to be absent from the current job and queue. Keep the existing 300-second polling deadline, actual storage-echo assertion, two upgraded results, cleared receipts, restart conservation, and 480-second test budget. This changes the fixture predicate, not production behavior or deadlines.
