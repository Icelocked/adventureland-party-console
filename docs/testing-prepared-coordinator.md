# Prepared coordinator deployment

Failure inventory, before implementation:

- Preparing or verifying a candidate must not pause the active party.
- A preparation failure must leave the active runtime and character connections unchanged.
- A prepared native tree must carry its own compatibility version; older artifacts must retain the validated installer fallback.
- Build-time transformation must not embed the build directory or account credentials.
- Activation must install only a verified artifact and preserve mutable native account/state files.
- All clients must acknowledge readiness before releasing maintenance, including rollback.

Measure an isolated native installation using the same artifact twice: legacy transformation/syntax validation versus prepared publication. Retain timings, output-file hashes and unchanged account/state sentinels. Compare the resulting executable files byte for byte. Separately retain a deployment-controller journey showing a deliberately delayed preparation while the maintenance endpoint remains inactive, followed by safety and readiness acknowledgements. These measurements exclude real game reconnect latency; headless process ownership is unchanged.

Run the focused installer and pause journeys with `E2E_PREPARED_ARTIFACT` pointing to a completed release's `app` directory and Playwright selecting `console-build-prepared.spec.ts`. The test copies native executable files into private output directories; it never touches the live installation. Without that environment variable, the benchmark reads only executable inputs from the installed native runtime into private output directories. It excludes account configuration, sessions and mutable storage, and runs normally in CI without skipped evidence.

Measured Windows results (2026-10-12), three repeated installations:

| Run | Legacy installer | Prepared publication | Saved |
| --- | ---: | ---: | ---: |
| 1 | 1.002 s | 0.305 s | 0.696 s |
| 2 | 0.915 s | 0.236 s | 0.679 s |
| 3 | 0.963 s | 0.305 s | 0.658 s |

Every resulting executable hash matched; account and storage sentinels survived. The preparation journey sampled the maintenance file throughout delayed preparation, then exercised preparation failure and successful safe activation. All samples remained unpaused until preparation completed.

The preceding real deployment took 233.753 seconds preparing, 3.037 seconds checking safety, 74.386 seconds activating, and 2.371 seconds releasing maintenance. Moving preparation ahead of maintenance would reduce that observed party interruption from 313.547 seconds to about 79 seconds, before the modest installer savings. This is a projection from the real phase timings, not a measured live deployment of the new implementation. Total spinner duration can remain similar: verification still runs, now while gameplay continues. Headless restart/reconnect latency is unchanged.

Host controller code is selected at host startup. Installing this scheduling improvement requires explicitly activating the candidate and explicitly restarting the host once; building alone performs neither operation.
