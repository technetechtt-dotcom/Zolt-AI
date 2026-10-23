# Staging deploy checklist

Use this before production. Advisory-only stays on. Plant control stays off.

## Environment

- [ ] Dedicated staging project (not this workstation sharing GridFlex `:5432` / `:6379`)
- [ ] Managed PostgreSQL with `sslmode=require` and WAL archiving
- [ ] Managed Redis
- [ ] TLS terminator; `ZOLT_TLS_TERMINATED=true`
- [ ] `NODE_ENV=production`
- [ ] `ZOLT_ADVISORY_ONLY=true`
- [ ] `ZOLT_ALLOW_INSECURE_AUTH` unset
- [ ] `ZOLT_API_KEY` unset
- [ ] Secrets in AWS Secrets Manager, GCP Secret Manager, or Azure Key Vault
- [ ] `ZOLT_MASTER_KEY` 32+ characters from the secrets manager

## Images and data

- [ ] Build API, gateway, worker, and Console with the git SHA tag
- [ ] `pnpm db:deploy`
- [ ] One-time seed, then rotate/revoke seed credentials
- [ ] Confirm login against the seeded admin, then disable that account if it is not the staging operator

## Prove recovery

- [ ] `pnpm test:restore` — logical dump restore, tenant rows present
- [ ] `pnpm test:pitr` — keep-probe restored, discard-probe excluded, RPO/RTO recorded
- [ ] `powershell -File scripts/chaos-test.ps1 -Target redis`
- [ ] `powershell -File scripts/chaos-test.ps1 -Target postgres`
- [ ] `/health/ready` returns 200 after each recovery

## Observability

- [ ] OTel collector, Prometheus, Grafana, Alertmanager running
- [ ] Scrape API `:4000/metrics` and gateway `:4001/metrics`
- [ ] Alertmanager delivers to a real pager/Slack route (not only `alert-sink`)

## Still required outside staging

Independent penetration test, named-inverter HIL, real plant datasets, billing/SLA/DPA.
