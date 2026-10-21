# Backup restore proof

Status: **RESTORE AND PITR NOT EXECUTED IN THIS ENVIRONMENT** because the Docker engine is unavailable.

Retried 2026-10-21T12:14Z: Docker Desktop was restarted and WSL shut down. `com.docker.service` is Stopped/Manual; `Start-Service` failed with “Cannot open com.docker.service” (elevation required). `docker info` timed out.

`scripts/verify-backup-restore.ps1` and `scripts/verify-pitr.ps1` are wired to container `zolt-postgres` with WAL `archive_mode=on`. They will measure RPO/RTO and prove a keep-probe restore that excludes a later discard-probe once Compose is healthy.

## Mandatory proof table

| Item | Evidence file | Value |
| --- | --- | --- |
| Restore date/time | `docs/operations/backup-restore-result.json` | _pending Docker engine_ |
| Restore RTO (seconds) | `docs/operations/backup-restore-result.json` | _pending Docker engine_ |
| PITR probe WAL LSN | `docs/operations/pitr-result.json` | _pending Docker engine_ |
| PITR measured RPO (seconds) | `docs/operations/pitr-result.json` | _pending Docker engine_ |
| Operator | local campaign | Docker service requires elevation |
| Witness | none | _pending_ |
