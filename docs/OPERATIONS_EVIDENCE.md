# Production-readiness evidence ledger

Updated: 2026-08-19

This file tracks **external validation blockers** that cannot be completed by code alone.

## Mandatory evidence checklist

| Blocker | Command / source of truth | Required artifact | Status |
| --- | --- | --- | --- |
| Physical GridFlex HIL (real Edge Node, real RS485, named inverter or high-fidelity emulator) | `pnpm test:hil -- --PortName COMx` | `docs/HIL_TEST_REPORT.md` updated with executed details and sign-off | Pending |
| Load test tier 10 devices | `pnpm test:load:10` | `docs/operations/load-10.json` | Pending |
| Load test tier 100 devices | `pnpm test:load:100` | `docs/operations/load-100.json` | Pending |
| Load test tier 1,000 devices | `pnpm test:load:1000` | `docs/operations/load-1000.json` | Pending |
| Load test tier 10,000 devices | `pnpm test:load:10000` | `docs/operations/load-10000.json` | Pending |
| Reconnect burst testing | `pnpm test:reconnect-burst` | `docs/operations/reconnect-burst.json` | Pending |
| 24-hour soak | `pnpm test:soak:24h` | `docs/operations/soak-24h.json` | Pending |
| Multi-day soak | `pnpm test:soak:multiday` | `docs/operations/soak-multiday.json` | Pending |
| Production chaos test | `pnpm test:chaos -- -Target redis` and `pnpm test:chaos -- -Target postgres` | `docs/operations/chaos-result.json` | Pending |
| Clean backup restoration | `pnpm test:restore` | `docs/operations/backup-restore-result.json` | Pending |
| PITR validation | `pnpm test:pitr` | `docs/operations/pitr-result.json` | Pending |
| Measured RPO and RTO acceptance | consolidate from restore + PITR artifacts | `docs/BACKUP_RESTORE_PROOF.md` with measured values | Pending |
| Independent penetration test | External assessor report | `docs/PENETRATION_TEST_REPORT.md` | Pending |
| Pen-test remediation | Internal ticket closure list | `docs/PENETRATION_TEST_REPORT.md` remediation section | Pending |
| Pen-test retest | External assessor retest report | `docs/PENETRATION_TEST_REPORT.md` retest section | Pending |
| Managed production secrets | Deployed secrets manager integration | `docs/SECRETS.md` production deployment section with evidence links | Pending |
| Rotate all pilot credentials | API/UI rotation records + audit | `docs/operations/credential-rotation.json` | Pending |
| Deploy real observability backends | Prometheus/Grafana/OTel deployment evidence | `docs/operations/observability-deploy.json` | Pending |
| Deploy real alert routing | Pager/alert destination proof | `docs/operations/alert-routing.json` | Pending |

## Automation gates

- `pnpm evidence:verify` checks critical evidence documents for required sections.
- Release tags (`v*`) enforce `evidence-release-gate` in CI.
- CI now blocks on critical security findings and release-time high+critical findings.

## Sign-off rule

No item may be marked complete without:
1. Artifact in `docs/operations/`
2. Timestamp and responsible operator
3. Reviewer sign-off
