# Deployment

## Environments

Keep separate development, staging and production projects with configuration parity:

| Variable                         | Dev                  | Staging / Production            |
| -------------------------------- | -------------------- | ------------------------------- |
| `NODE_ENV`                       | development          | production                      |
| `ZOLT_ADVISORY_ONLY`             | true                 | true                            |
| `ZOLT_ALLOW_INSECURE_AUTH`       | true (local only)    | unset / forbidden               |
| `ZOLT_TLS_TERMINATED`            | optional             | true                            |
| `ZOLT_AUTO_PROVISION_IDENTITIES` | optional             | false                           |
| `ZOLT_SECRETS_PROVIDER`          | optional             | managed provider name; required |
| `ZOLT_API_KEY`                   | local bootstrap only | unset; startup fails if present |

## Containers

Each app has a production Dockerfile. Tag images with git SHA. Do not mutate a published tag.

```bash
docker build -f apps/api/Dockerfile -t zolt-api:$SHA .
docker build -f apps/connector-gateway/Dockerfile -t zolt-gateway:$SHA .
docker build -f apps/worker/Dockerfile -t zolt-worker:$SHA .
docker build -f apps/console/Dockerfile -t zolt-console:$SHA .
```

Use managed PostgreSQL and Redis. Set PostgreSQL connection parameters such as `sslmode=require`, `connection_limit`, `pool_timeout`, `connect_timeout` and provider-supported statement/query timeout in `DATABASE_URL`. Set `ZOLT_SLOW_QUERY_MS` and alert on emitted `database.slow_query` events. Enable storage/database/backup encryption under customer-managed keys where required and prove restore/PITR (see `docs/BACKUP_RESTORE_PROOF.md`).

Production startup is fail-closed unless TLS termination, advisory-only mode, database/Redis, a managed secrets provider, and a 32+ character master key are configured. API, gateway and workers use database-backed expiring credentials; environment bootstrap authentication cannot be enabled in production.

## Scaling

API and workers are stateless. Scale horizontally behind a load balancer. Workers use `WORKER_CONCURRENCY`. Enable rolling deploys; roll back by redeploying the previous image tag.

Blue/green and multi-region DR are commercial follow-ups once a single-region restore drill is proven.

## Observability

Route structured service logs and `database.slow_query` events to the central log platform. Scrape health/metrics and queue-health endpoints into the selected OpenTelemetry/Prometheus backend and alert using `docs/RUNBOOKS.md`. The repository exposes instrumentation inputs; the backend, Grafana dashboards and notification destinations must be deployed in the production environment.
