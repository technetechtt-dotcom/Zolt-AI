# Implementation status

## Phase 1 — Production security

- [x] HMAC verified before replay claim
- [x] Database-backed tenant/product/installation-scoped hashed credentials
- [x] Expiry, revocation, rotation, last-used, credential audit
- [x] RBAC roles and permissions, memberships, sessions
- [x] Fail-closed auth; insecure auth disabled in production
- [x] Rate limits, body/batch limits, security headers, CORS, trusted proxies, TLS check
- [x] Secret scanning, SBOM, Dependabot, Trivy/Gitleaks CI jobs
- [x] `ZOLT_ALLOWED_INSTALLATIONS` removed from the production path

## Phase 2 — Data reliability

- [x] Canonical telemetry validation (ranges, NaN, units, clock drift, stale/delayed/out-of-order)
- [x] Composite tenant-ownership foreign keys and status enums
- [x] GridFlex 1.0 mapping, simulated vs live, firmware/vendor/modbus/health
- [x] Queue retries, poison isolation, max queue age, dead-letter
- [x] Per-tenant ingest quotas (tenant rate limit + tenant.ingestQuotaPerMinute)
- [ ] Hardware-in-the-loop against a physical inverter (requires lab)

## Phase 3 — Operations

- [x] Structured JSON logs, correlation IDs, `/metrics`, `/health/system`
- [x] Backup/restore and SLO runbooks
- [x] Staging/production configuration documented
- [ ] Live load/soak/chaos and independent penetration test

## Phase 4 — Product UI

- [x] Zolt Console (login, fleet, telemetry, recommendations, users, webhooks, credentials, audit, health, copilot)
- [ ] Pixel-complete design system and realtime websocket charts

## Phase 5 — Energy intelligence

- [x] Expanded energy skill pack and calibrated confidence
- [x] Impact fields, deadlines, operator feedback
- [x] Statistical analytics helpers (rolling average/variance, z-score, trend, change-point)
- [ ] Market-grade forecasting trained on production data

## Phase 6 — Industrial AI

- [x] Copilot retrieval with tenant binding and no plant commands
- [x] Digital twin types with simulated vs live separation
- [x] MLOps model registry scaffold
- [ ] Trained inverter/PdM models and optimisation solver in production

## Phase 7 — Commercial scale

- [x] Plan/quota/usage meter schema
- [x] POPIA-oriented retention fields and offboarding notes in runbooks
- [ ] Billing integration, contractual SLAs, multi-region DR
