# Load, soak, and chaos report

Status: **PRODUCTION-STYLE RUNS NOT EXECUTED**.

`scripts/load-test.ts` generates explicitly simulated GridFlex telemetry for configurable device/message counts and reports throughput plus P50/P95/P99. Run separate signed tests for 10, 100, 1,000 and 10,000 devices, reconnect bursts, 24 hours, and multiple days. Capture API/gateway/worker latency, queue age/depth, PostgreSQL throughput/connections, Redis utilisation, recommendation latency, error rate, environment sizing, and commit SHA.

`scripts/chaos-test.ps1` stops only the named Compose `redis` or `postgres` service, restarts it, measures readiness recovery, and writes a result. Worker termination, packet loss, slow DB, webhook failure and rolling deployment require equivalent environment-specific drills.
