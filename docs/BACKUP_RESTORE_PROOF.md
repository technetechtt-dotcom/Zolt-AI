# Backup restore proof

Status: **RESTORE NOT EXECUTED IN THIS ENVIRONMENT** because Docker/PostgreSQL was unavailable.

Run `pnpm test:restore` against the explicitly named non-production container. The harness creates a uniquely prefixed scratch database, restores a custom-format dump, verifies tenant data, measures recovery time, writes `docs/operations/backup-restore-result.json`, and removes the scratch database and temporary dump. Production evidence must also state backup encryption/KMS key, point-in-time recovery window, achieved RPO/RTO, operator, witness, source snapshot, and target isolation.
