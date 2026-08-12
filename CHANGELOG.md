# Changelog

## 0.2.0 - 2026-08-12

- Tenant-scoped hashed API credentials with expiry, revocation, rotation, last-used and audit
- RBAC roles and permissions, memberships, sessions, service/device identity kinds
- HMAC signature verification before replay-key claim
- Database-backed installation identities; `ZOLT_ALLOWED_INSTALLATIONS` removed from production path
- Rate limits, body/batch limits, security headers, CORS, trusted proxy and TLS production checks
- Composite tenant-ownership foreign keys for products, installations, devices, assets, telemetry and recommendations
- GridFlex connector 1.0 canonical mapping with simulated/live markers
- Energy capability pack expansion and calibrated confidence
- Database-backed webhooks with signed deliveries, retries and disable-after-failure
- Zolt Console, Copilot retrieval (non-controlling), analytics and MLOps scaffolds
- CI secret scan, SBOM, Dependabot, Dockerfiles and security documentation

## 0.1.0

- Initial advisory-only foundation, gateway, worker, Prisma schema and smoke tests
