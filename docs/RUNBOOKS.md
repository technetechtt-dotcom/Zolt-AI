# Production runbooks

## SLIs / SLOs

| SLI | SLO |
| --- | --- |
| API availability | 99.5% monthly excluding planned maintenance |
| Ingest success rate | 99% of authenticated valid payloads accepted |
| Recommendation freshness | 95% of ingest jobs processed within 2 minutes |
| Webhook delivery | 99% delivered or in retry/DLQ within 15 minutes |

## Alert thresholds

- API 5xx > 2% for 10 minutes
- Gateway ingest failures > 5% for 10 minutes
- Queue depth > 10,000 or oldest message age > 10 minutes
- Dead-letter growth > 50/hour
- Postgres unavailable or query p95 > 2s
- Redis unavailable
- Authentication failure spike > 20/minute
- Replay detections > 10/minute
- Webhook failure rate > 20%
- Skill execution errors > 5% of analyses

Escalate to the on-call engineer, then the tenant administrator for customer-impacting ingest loss.

## Backup and restore drill

1. Take an encrypted logical dump of PostgreSQL (`pg_dump -Fc`).
2. Restore into a scratch database.
3. Run `pnpm db:deploy` (should be no-op) and `pnpm smoke:e2e` against the restored data with a throwaway credential.
4. Record the drill date in the operations log.

## Migration rollback

Prisma migrate deploy is forward-only in production. Rollback procedure:

1. Restore the pre-migration database backup.
2. Redeploy the previous application image tag.
3. If only additive schema was applied and is compatible, a code rollback without DB rollback may be possible; confirm with `docs/ARCHITECTURE.md`.

Never run untested migrations against production-sized data. Replay migrations on a restored production snapshot in staging first.

## Timescale / partitioning

When telemetry volume warrants it, attach TimescaleDB or native range partitions on `"TelemetryMessage"("sourceTimestamp")`. The current btree indexes on `(tenantId, productId, deviceId, sourceTimestamp)` are the starting point.
