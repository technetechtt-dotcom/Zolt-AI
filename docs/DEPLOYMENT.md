# Deployment

## Environments

Keep separate development, staging and production projects with configuration parity:

| Variable | Dev | Staging / Production |
| --- | --- | --- |
| `NODE_ENV` | development | production |
| `ZOLT_ADVISORY_ONLY` | true | true |
| `ZOLT_ALLOW_INSECURE_AUTH` | true (local only) | unset / forbidden |
| `ZOLT_TLS_TERMINATED` | optional | true |
| `ZOLT_AUTO_PROVISION_IDENTITIES` | optional | false |

## Containers

Each app has a production Dockerfile. Tag images with git SHA. Do not mutate a published tag.

```bash
docker build -f apps/api/Dockerfile -t zolt-api:$SHA .
docker build -f apps/connector-gateway/Dockerfile -t zolt-gateway:$SHA .
docker build -f apps/worker/Dockerfile -t zolt-worker:$SHA .
docker build -f apps/console/Dockerfile -t zolt-console:$SHA .
```

Use managed PostgreSQL and Redis. Enable encrypted backups and a documented restore test (see `docs/RUNBOOKS.md`).

## Scaling

API and workers are stateless. Scale horizontally behind a load balancer. Workers use `WORKER_CONCURRENCY`. Enable rolling deploys; roll back by redeploying the previous image tag.

Blue/green and multi-region DR are commercial follow-ups once a single-region restore drill is proven.
