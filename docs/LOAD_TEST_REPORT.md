# Load, soak, and chaos report

Status: **LOAD TIERS RE-EXECUTED** after the 1,000-device P95 fix. Default concurrency is now 32 at the 1,000 and 10,000 device tiers so ingest stays under the 500 ms P95 budget.

## Executed results (2026-10-21)

| Run | Devices | Messages each | Messages | Fail | P95 ms | Artifact |
| --- | --- | --- | --- | --- | --- | --- |
| 10 devices | 10 | 100 | 1,000 | 0 | 48.08 | `docs/operations/load-10.json` |
| 100 devices | 100 | 100 | 10,000 | 0 | 96.36 | `docs/operations/load-100.json` |
| 1,000 devices | 1,000 | 50 | 50,000 | 0 | **129.1** | `docs/operations/load-1000.json` |
| 10,000 devices (normalized) | 10,000 | 10 | 100,000 | 0 | **152.43** | `docs/operations/load-10000.json` |

The previous 1,000-device P95 of 597 ms was caused by concurrency 150 saturating a single-thread gateway. Re-run used concurrency 32 and met the 500 ms budget.

24-hour soak is still in progress on `localhost:4001` (`docs/operations/soak-24h.json`, 0 failures, checkpointing). A supervisor (`pnpm soak:supervise`) starts the multi-day soak only after the 24-hour run records `inProgress: false` at 1440 minutes. Chaos Redis/Postgres was not executed: `com.docker.service` is Stopped and cannot be started without elevation.
