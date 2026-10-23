# Implementation status

Updated: 2026-10-23. “Implemented” means code/configuration exists and automated local checks pass. Operational evidence is listed separately; items that did not execute in this environment are **not** marked complete.

## Implemented in the repository

- Tenant-membership roles with per-tenant role keys, tenant-bound sessions, installation grants, and composite database constraints for roles, credentials, telemetry, recommendations and installation access.
- IDOR/access filters, multi-tenant role integration harness, audited role/access changes, user deactivation/dormancy, tenant switching and tenant export/offboarding/deletion workflows.
- Production bootstrap denial, production configuration gate, expiring/rotatable/revocable credentials, high-risk approval, service/device kinds and expiry warnings.
- TOTP/recovery codes, invitations, email verification, password reset/policy, lockout/unlock, login throttling, session-device visibility and administrator/all-session revocation. Enterprise OIDC/SAML remains intentionally deferred.
- HMAC-before-replay ingest, fail-closed auth, hashed API credentials, webhook SSRF/DNS-rebinding controls, HTTPS/port/redirect/time/body/concurrency/quota limits, secret rotation, test delivery, manual redelivery and delivery history APIs. Skipped HIGH/CRITICAL security checks fail the assessment.
- Queue retry/fairness/priority, poison quarantine, dead-letter health/list/retry/purge, graceful shutdown, oldest-message metrics and idempotent recommendation persistence.
- Canonical schemas and migration policy, configurable physical profiles, telemetry completeness/quality/clock/trust scoring, anomaly checks and sensor calibration history.
- Tenant-safe Copilot retrieval with permission filtering, citations, generated-inference labels, injection checks and no plant tools.
- Console tenant switch, permissions-aware navigation, authenticated SSE charts, recommendations, RBAC, credential/webhook/audit/model/queue/health surfaces.
- Versioned configurable energy rules, leakage-controlled forecast/anomaly training, digital-twin separation and advisory-only optimiser. Horizon optimisation holds through a cheap shoulder and discharges at the later peak; combined objective `recoveredEnergyKwh + 0.25 * estimatedRevenueImpact` beat greedy by **51.8** on the 24-hour validation day (`docs/operations/models/optimisation-validation.json`).
- Retention/archive jobs, slow-query events, health/queue metrics, OpenAPI and operations/compliance/commercial documentation.
- Blocking CI: secret scan and CRITICAL dependency/filesystem gates; HIGH blocks release tags. Actions are commit-SHA pinned.
- Compose definitions for Postgres (WAL archive_mode=on), Redis, OTel collector, Prometheus, Grafana, Alertmanager and alert-sink (`docker-compose.yml`, `ops/observability/`).
- Load harness with index-cursor dispatch, P95 budget 500 ms, soak checkpointing, and a supervisor that starts the multi-day soak only after 1,440 minutes complete.

## Executed evidence (2026-10-21)

| Item | Result | Artifact |
| --- | --- | --- |
| Load 10 devices | 1,000 msgs, 0 fail, P95 48.08 ms | `docs/operations/load-10.json` |
| Load 100 devices | 10,000 msgs, 0 fail, P95 96.36 ms | `docs/operations/load-100.json` |
| Load 1,000 devices | 50,000 msgs, 0 fail, P95 **129.1 ms** | `docs/operations/load-1000.json` |
| Load 10,000 devices | 100,000 msgs, 0 fail, P95 **152.43 ms** | `docs/operations/load-10000.json` |
| Reconnect burst | 2 bursts, 6,000 msgs, 0 fail, P95 218.12 ms | `docs/operations/reconnect-burst.json` |
| 24-hour soak | **In progress** on `localhost:4001` (checkpointing, 0 failures) | `docs/operations/soak-24h.json` |
| Multi-day soak | Queued behind 24h; supervisor running | `docs/operations/soak-multiday.json` |
| GridFlex HIL emulator | PASS, function 03 only, plant control off | `docs/operations/hil-emulator-result.json` |
| Internal security pre-assessment | PASS (PT-001–PT-006; skipped HIGH/CRITICAL would FAIL) | `docs/operations/security-assessment.json` |
| Emulator forecast / anomaly train | Test MAE 4.66 kW; anomaly test F1 0.67 | `docs/operations/ml-training-result.json` |
| Horizon vs greedy | +51.8 combined objective, constraints satisfied, advisory-only | `docs/operations/models/optimisation-validation.json` |
| Backup restore | PASS, 1 tenant, RTO 3.76 s | `docs/operations/backup-restore-result.json` |
| PITR | PASS, RPO 4.69 s, RTO 5.59 s | `docs/operations/pitr-result.json` |
| Local observability | Prometheus :9096, Grafana :3002, Alertmanager :9093 | `docs/operations/observability-deploy.json` |
| Redis/Postgres chaos | PASS — API/gateway/worker recovered in 5.69 s (Redis) and 10.07 s (Postgres) without operator restart; 0 duplicate recommendations | `docs/operations/chaos-result.json` |
| Fresh 24-hour soak | Started 2026-10-23; prior unfinished artifact discarded | `docs/operations/soak-24h.json` |
| Managed secrets | Local AES-GCM only; cloud backend blocked until `ZOLT_SECRETS_PROVIDER` + CLI credentials | `docs/operations/managed-secrets.json` |
| Real-data ML gate | FAIL closed (no named plant dataset) | `docs/operations/real-data-gate.json` |
| Field pilot | BLOCKED — no named site attached | `docs/operations/field-pilot.json` |
| Commercial package | SLA, onboarding, escalation, DPA/POPIA summary, acceptance, success report | `docs/pilot/COMMERCIAL_PACKAGE.md` |

## Evidence still required outside this environment

These were attempted and **did not complete**. They are not claimed as done.

- **Physical GridFlex HIL** with a named inverter and genuine USB-RS485 path.
- **Finish the fresh 24-hour soak then multi-day soak** (instrumented for heap, queue, P95/P99; cannot complete in-session).
- **Queued telemetry survival across Redis AOF** still measured false on the 2026-10-23 Redis run; reconnect itself PASSed.
- **Staging observability cluster** with a real pager/Slack/Teams destination (local Grafana :3002 / Prometheus :9096 / Alertmanager :9093 remain workstation-bound).
- **Independent penetration test**: commissioning pack ready (`docs/PENTEST_COMMISSIONING.md`). `pnpm pentest:commission` remains `NOT_COMMISSIONED` until `ZOLT_PENTEST_VENDOR`, `ZOLT_PENTEST_ENGAGEMENT_ID`, and `ZOLT_PENTEST_START_DATE` are set after a signed SOW.
- **Production/staging secrets manager**: rotator supports AWS/GCP/Azure CLIs. No cloud credentials are configured, so values remain local AES-GCM.
- **Real named-plant GridFlex telemetry and model validation**: `pnpm ml:real-gate` fails closed without `ZOLT_REAL_PLANT_ID` and `ZOLT_REAL_DATASET_PATH`.
- Signed DPA/SLA with a customer (templates are in `docs/pilot/COMMERCIAL_PACKAGE.md`).
- Automatic plant execution remains out of scope. The loop is Predict → Optimise → Simulate → Human approve (`docs/ADVISORY_LOOP.md`).

Staging go-live steps: `docs/STAGING_CHECKLIST.md`. Evidence ledger: `docs/OPERATIONS_EVIDENCE.md`.
