# Implementation status

Updated: 2026-08-12. “Implemented” means code/configuration exists and automated local checks pass. It does not mean external operational evidence exists; see `OPERATIONS_EVIDENCE.md`.

## Implemented in the repository

- Tenant-membership roles with per-tenant role keys, tenant-bound sessions, installation grants, and composite database constraints for roles, credentials, telemetry, recommendations and installation access.
- IDOR/access filters, multi-tenant role integration harness, audited role/access changes, user deactivation/dormancy, tenant switching and tenant export/offboarding/deletion workflows.
- Production bootstrap denial, production configuration gate, expiring/rotatable/revocable credentials, high-risk approval, service/device kinds and expiry warnings.
- TOTP/recovery codes, invitations, email verification, password reset/policy, lockout/unlock, login throttling, session-device visibility and administrator/all-session revocation. Enterprise OIDC/SAML remains intentionally deferred.
- Webhook SSRF/DNS-rebinding controls, HTTPS/port/redirect/time/body/concurrency/quota limits, secret rotation, test delivery, manual redelivery and delivery history APIs.
- Queue retry/fairness/priority, poison quarantine, dead-letter health/list/retry/purge, graceful shutdown, oldest-message metrics and idempotent recommendation persistence.
- Canonical schemas and migration policy, configurable physical profiles, telemetry completeness/quality/clock/trust scoring, anomaly checks and sensor calibration history.
- Tenant-safe Copilot retrieval with permission filtering, citations, generated-inference labels, injection checks and no plant tools.
- Console tenant switch, permissions-aware navigation, authenticated SSE charts, recommendations, RBAC, credential/webhook/audit/model/queue/health surfaces.
- Versioned configurable energy rules, forecast baseline/confidence inputs, anomaly heuristic, loss impacts, model governance metadata/drift disablement, digital-twin separation and constrained advisory optimiser.
- Retention/archive jobs, slow-query events, health/queue metrics, OpenAPI and operations/compliance/commercial documentation.
- Blocking CI: secret scan and CRITICAL dependency/filesystem gates; HIGH blocks release tags. Actions are commit-SHA pinned.

## Evidence still required outside this environment

- Physical GridFlex Edge Node, actual RS485 and a named supported inverter/emulator HIL run.
- 10/100/1,000/10,000-device load, reconnect burst, 24-hour/multi-day soak and production chaos results.
- Clean backup restore/PITR proof with measured RPO/RTO.
- Independent penetration test, remediation and retest.
- Production managed-secrets deployment and rotation of every pilot credential.
- Deployment of the selected OpenTelemetry/Prometheus/Grafana/log/alert backends and notification routes.
- Real labelled plant datasets, leakage-controlled training/validation/test splits, plant validation, market-grade forecasts, and production anomaly/predictive-maintenance models.
- External billing/payment provider, executed SLAs/support structure/privacy/DPA/terms and multi-region DR.
