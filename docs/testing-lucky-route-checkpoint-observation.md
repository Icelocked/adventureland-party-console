# Lucky journal request observation

Run 38324209160 failed with `Route is already handled` in the production-request hook. The test's recovery hold flag was never enabled, but every intercepted request still awaited a native CODE query before continuing. CODE replacement or request retirement during that unnecessary wait could leave it continuing an expired route.

Remove the inactive abort gate and native query from the hook. Keep the actual swap-failure injection, mandatory native fault poll, and checkpoint observation. The single owned handler records only the merchant's matching complete journal and immediately continues the request; unregister only that handler. Keep all result, cargo, receipt, spending, restart, and timeout assertions unchanged. Do not swallow route errors or manufacture a journal.
