# Load, soak, and chaos report

Status: **PRODUCTION-STYLE RUNS NOT EXECUTED**.

`scripts/load-test.ts` generates explicitly simulated GridFlex telemetry for configurable device/message counts and reports throughput plus P50/P95/P99. Run separate signed tests for 10, 100, 1,000 and 10,000 devices, reconnect bursts, 24 hours, and multiple days. Capture API/gateway/worker latency, queue age/depth, PostgreSQL throughput/connections, Redis utilisation, recommendation latency, error rate, environment sizing, and commit SHA.

`scripts/chaos-test.ps1` stops only the named Compose `redis` or `postgres` service, restarts it, measures readiness recovery, and writes a result. Worker termination, packet loss, slow DB, webhook failure and rolling deployment require equivalent environment-specific drills.

## Required executions

- `pnpm test:load:10` -> `docs/operations/load-10.json`
- `pnpm test:load:100` -> `docs/operations/load-100.json`
- `pnpm test:load:1000` -> `docs/operations/load-1000.json`
- `pnpm test:load:10000` -> `docs/operations/load-10000.json`
- `pnpm test:reconnect-burst` -> `docs/operations/reconnect-burst.json`
- `pnpm test:soak:24h` -> `docs/operations/soak-24h.json`
- `pnpm test:soak:multiday` -> `docs/operations/soak-multiday.json`

## Acceptance thresholds

- Failed requests: `< 0.1%` at each tier
- Gateway accepted rate: sustained and monotonic with scale
- Queue oldest age: `< 120s` steady state
- API P95 latency: `< 500ms` for ingestion endpoints
- Recovery after reconnect burst: `< 60s` without data loss
- Soak run memory growth: no unbounded growth trend
