# Backup restore proof

Status: **EXECUTED on local Zolt Postgres** (`zolt-postgres` on host port 5433) on 2026-10-22.

This is a single-node Docker restore drill, not multi-region DR.

## Mandatory proof table

| Item | Evidence file | Value |
| --- | --- | --- |
| Restore date/time | `docs/operations/backup-restore-result.json` | 2026-10-22T12:39:37Z |
| Restore RTO (seconds) | `docs/operations/backup-restore-result.json` | **3.76** (logical dump into a side database, 1 tenant row) |
| PITR probe WAL LSN | `docs/operations/pitr-result.json` | `0/3525688` |
| PITR measured RPO (seconds) | `docs/operations/pitr-result.json` | **4.69** |
| PITR measured RTO (seconds) | `docs/operations/pitr-result.json` | **5.59** |
| PITR keep/discard | `docs/operations/pitr-result.json` | keep present, discard excluded, archive_mode=on, 4 WAL files |
| Operator | local campaign | Docker engine healthy |
| Witness | none | _pending independent review_ |
