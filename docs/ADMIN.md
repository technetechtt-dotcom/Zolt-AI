# Administrator guide

- Seed RBAC, the demo tenant and a bootstrap API credential with `pnpm db:seed`.
- Create hashed, tenant-scoped credentials in Console or `POST /v1/credentials`. Rotate and revoke from the same UI.
- Register webhooks per tenant. Endpoints disable after 10 consecutive failures.
- Review `/v1/audit` and `/v1/users` during access reviews.
- Keep `ZOLT_ADVISORY_ONLY=true`. Do not set `ZOLT_ALLOW_INSECURE_AUTH` in production.
- Store `ZOLT_MASTER_KEY` and database URLs in a managed secrets service. See `docs/SECRETS.md`.
