# Backup restore proof

Status: **RESTORE NOT EXECUTED IN THIS ENVIRONMENT** because Docker/PostgreSQL was unavailable.

Run `pnpm test:restore` against the explicitly named non-production container. The harness creates a uniquely prefixed scratch database, restores a custom-format dump, verifies tenant data, measures recovery time, writes `docs/operations/backup-restore-result.json`, and removes the scratch database and temporary dump. Production evidence must also state backup encryption/KMS key, point-in-time recovery window, achieved RPO/RTO, operator, witness, source snapshot, and target isolation.

Run `pnpm test:pitr` to capture WAL/PITR timing probes in `docs/operations/pitr-result.json`.

## Mandatory proof table

| Item | Evidence file | Value |
| --- | --- | --- |
| Restore date/time | `docs/operations/backup-restore-result.json` | _pending_ |
| Restore RTO (seconds) | `docs/operations/backup-restore-result.json` | _pending_ |
| PITR probe WAL LSN | `docs/operations/pitr-result.json` | _pending_ |
| PITR measured RPO (seconds) | `docs/operations/pitr-result.json` | _pending_ |
| Operator | manual | _pending_ |
| Witness | manual | _pending_ |

## Required acceptance

- Restore database is cleanly created and destroyed
- Tenant count and critical table row counts match expected source bounds
- Measured RPO and RTO are within pilot contractual targets
