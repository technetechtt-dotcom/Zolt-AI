# Administrator guide

- Seed RBAC and development identities with `pnpm db:seed`. Production uses one-time seed-only secrets and rejects the development defaults.
- Create hashed, tenant-scoped credentials in Console or `POST /v1/credentials`. Rotate and revoke from the same UI.
- Register webhooks per tenant. Endpoints disable after 10 consecutive failures.
- Review `/v1/audit`, `/v1/users`, `/v1/users/dormant`, session devices, tenant roles, installation grants and credentials quarterly. Record role/access changes in audit.
- Enrol privileged humans in MFA, store recovery codes offline, use invitation/reset/email verification workflows, and revoke all sessions after suspected compromise.
- Use queue health/DLQ/quarantine endpoints and webhook delivery history; retries/purges require an incident or change record.
- Keep `ZOLT_ADVISORY_ONLY=true`. Do not set `ZOLT_ALLOW_INSECURE_AUTH` in production.
- Store `ZOLT_MASTER_KEY` and database URLs in a managed secrets service. See `docs/SECRETS.md`.
