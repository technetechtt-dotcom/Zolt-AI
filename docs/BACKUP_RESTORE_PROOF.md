# Backup restore proof

Status: **RESTORE NOT EXECUTED IN THIS ENVIRONMENT** because the Docker engine is unavailable (HTTP 500).

`scripts/verify-backup-restore.ps1` and `scripts/verify-pitr.ps1` are wired to container `zolt-postgres` with WAL `archive_mode=on`. They will measure RPO/RTO and prove a keep-probe restore that excludes a later discard-probe once Compose is healthy.

## Mandatory proof table

| Item | Evidence file | Value |
| --- | --- | --- |
| Restore date/time | `docs/operations/backup-restore-result.json` | _pending Docker_ |
| Restore RTO (seconds) | `docs/operations/backup-restore-result.json` | _pending Docker_ |
| PITR probe WAL LSN | `docs/operations/pitr-result.json` | _pending Docker_ |
| PITR measured RPO (seconds) | `docs/operations/pitr-result.json` | _pending Docker_ |
| Operator | local campaign | Docker engine down |
| Witness | none | _pending_ |
