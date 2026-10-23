# Production-readiness evidence ledger

Updated: 2026-10-21

This file tracks **external validation blockers** and what this campaign actually executed.

## Mandatory evidence checklist

| Blocker | Command / source of truth | Required artifact | Status |
| --- | --- | --- | --- |
| Physical GridFlex HIL (real Edge Node, real RS485, named inverter or high-fidelity emulator) | `pnpm test:hil -- --PortName COMx` / `pnpm test:hil:emulator` | `docs/HIL_TEST_REPORT.md` | Emulator PASS; COM7 is a Huawei modem, Modbus timeout, no named inverter |
| Load test tier 10 devices | `pnpm test:load:10` | `docs/operations/load-10.json` | Executed, 0 failures |
| Load test tier 100 devices | `pnpm test:load:100` | `docs/operations/load-100.json` | Executed, 0 failures |
| Load test tier 1,000 devices | `pnpm test:load:1000` | `docs/operations/load-1000.json` | Executed, 0 failures |
| Load test tier 10,000 devices | `pnpm test:load:10000` | `docs/operations/load-10000.json` | Executed, 0 failures |
| Reconnect burst testing | `pnpm test:reconnect-burst` | `docs/operations/reconnect-burst.json` | Executed, 2 bursts, 0 failures |
| 24-hour soak | `pnpm test:soak:24h` | `docs/operations/soak-24h.json` | In progress on :4001, 0 failures, supervisor watching |
| Multi-day soak | `pnpm test:soak:multiday` | `docs/operations/soak-multiday.json` | Queued; starts only after 1,440 minutes complete |
| Production chaos test | `pnpm test:chaos:redis` and `pnpm test:chaos:postgres` | `docs/operations/chaos-result.json` | Executed FAIL — Redis/Postgres restart; `/health/ready` did not return 200 within ~120 s |
| Clean backup restoration | `pnpm test:restore` | `docs/operations/backup-restore-result.json` | PASS, 1 tenant, RTO 3.76 s |
| PITR validation | `pnpm test:pitr` | `docs/operations/pitr-result.json` | PASS, keep-probe restored, discard excluded |
| Measured RPO and RTO acceptance | consolidate from restore + PITR artifacts | `docs/BACKUP_RESTORE_PROOF.md` | RPO 4.69 s, RTO 5.59 s (PITR); restore RTO 3.76 s |
| Independent penetration test | External assessor report | `docs/PENETRATION_TEST_REPORT.md` | Commissioning pack ready; not independently executed |
| Pen-test remediation | Internal ticket closure list | `docs/PENETRATION_TEST_REPORT.md` remediation section | Pending independent test |
| Pen-test retest | External assessor retest report | `docs/PENETRATION_TEST_REPORT.md` retest section | Pending |
| Managed production secrets | Deployed secrets manager integration | `docs/SECRETS.md` / `docs/operations/managed-secrets.json` | Local AES-GCM store rotated |
| Rotate all pilot credentials | API/UI rotation records + audit | `docs/operations/credential-rotation.json` | Local managed-secret rotation executed |
| Deploy real observability backends | Prometheus/Grafana/OTel deployment evidence | `docs/operations/observability-deploy.json` | DEPLOYED_LOCAL (Prometheus :9096, Grafana :3002). Not a production cluster |
| Deploy real alert routing | Pager/alert destination proof | `docs/operations/alert-routing.json` | Alertmanager live to local alert-sink; no PagerDuty/Slack |

## Automation gates

- `pnpm evidence:verify` checks critical evidence documents for required sections.
- Release tags (`v*`) enforce `evidence-release-gate` in CI.
- CI now blocks on critical security findings and release-time high+critical findings.

## Sign-off rule

No item may be marked complete without:
1. Artifact in `docs/operations/`
2. Timestamp and responsible operator
3. Reviewer sign-off
