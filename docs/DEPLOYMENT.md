# Production deployment and promotion gates

Promotion path: **dev → test → staging → pilot → production**.

Each environment requires:

- Immutable application images (API, gateway, worker, console)
- TLS terminated at a reverse proxy / load balancer
- Managed PostgreSQL
- Managed Redis or an HA equivalent with AOF/persistence
- A managed secrets manager (AWS Secrets Manager, Azure Key Vault, or GCP Secret Manager)
- Persistent observability (Prometheus, Grafana, OpenTelemetry, Alertmanager)
- Production DNS names

## Gates

| Gate | Must pass |
| --- | --- |
| test | typecheck, unit, DB isolation, integration smoke, secret scan, dependency scan, Trivy, lint |
| staging | 24h soak <0.1% failures, Redis/Postgres chaos with queue survival, restore/PITR, observability live, secrets rotated |
| pilot | physical HIL, independent pen-test retest, named site, advisory-only, acceptance criteria |
| production | legal/DPA/SLA signed, billing live, DR tested against contractual RPO/RTO |

Automatic plant execution remains disabled in every environment.
