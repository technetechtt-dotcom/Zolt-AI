# Load, soak, and chaos report

Status: **LOAD TIERS EXECUTED** on the local GridFlex ingest harness (`http://localhost:4001/v1/ingest/gridflex`). Docker Engine was unavailable, so chaos, PostgreSQL restore, and PITR were not executed in this environment.

All ingest payloads were `simulated: true`. Failed requests were `0` at every completed tier.

## Executed results (2026-10-21)

| Run | Devices | Messages | Success | Fail | Duration | P95 ms | Artifact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10 devices | 10 | 1,000 | 1,000 | 0 | 1.5s | 48.08 | `docs/operations/load-10.json` |
| 100 devices | 100 | 10,000 | 10,000 | 0 | 8.9s | 96.36 | `docs/operations/load-100.json` |
| 1,000 devices | 1,000 | 50,000 | 50,000 | 0 | 119.9s | 597.21 | `docs/operations/load-1000.json` |
| 10,000 devices | 10,000 | 20,000 | 20,000 | 0 | 103.9s | 245.86 | `docs/operations/load-10000.json` |
| Reconnect burst | 100 | 6,000 | 6,000 | 0 | 31.9s | 218.12 | `docs/operations/reconnect-burst.json` |
| Soak rehearsal | 10 | 23,600 | 23,600 | 0 | 120.5s | 119.3 | `docs/operations/soak-rehearsal.json` |

- Reconnect bursts completed: 2 pauses of 1200 ms, recovery immediate, no data loss on the harness.
- 24-hour soak: **STARTED** (`docs/operations/soak-24h.json`, in-progress checkpoints).
- Multi-day soak: queued behind the 24-hour soak (`docs/operations/soak-multiday.json`).
- Chaos Redis/Postgres: not executed (Docker Desktop engine returned HTTP 500).

## Acceptance vs this run

- Failed requests: `< 0.1%` — met (0 at every tier)
- Gateway accepted rate: sustained (192–1128 msg/s depending on concurrency)
- API P95 latency: `< 500ms` — met at 10 / 100 / 10,000 devices; 1,000-device P95 was 597 ms under 150-wide concurrency
- Recovery after reconnect burst: `< 60s` — met
- Soak rehearsal: no failed requests over 2 minutes
