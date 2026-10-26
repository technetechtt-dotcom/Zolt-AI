# Telemetry capacity assumptions

These are design assumptions, not measured production throughput.

| Dimension | Pilot | Standard | Stretch design |
| --- | --- | --- | --- |
| Devices / site | 25 | 200 | 1,000 |
| Sites / tenant | 1 | 25 | 250 |
| Message interval | 10 s | 10 s | 5–10 s |
| Sustained messages / s | 3 | 50 | 1,000 |
| Burst messages / s | 10 | 150 | 3,000 |
| Payload size | ≤ 8 KiB | ≤ 8 KiB | ≤ 16 KiB |
| Hot retention | 90 days | 90 days | 90 days hot + archive |
| Recommendation retention | 365 days | 365 days | contract |
| Audit retention | 7 years | 7 years | 7 years |

A 10,000-device estate publishing every 10 seconds is approximately 1,000 messages/s plus bursts. Capacity claims must come from production-like traffic against the staged stack, not from arbitrary local concurrency.
