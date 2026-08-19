# Commercial operating policy

Plans: Pilot (fixed sites/devices and advisory-only); Standard (production ingestion, support and retention); Enterprise (contracted quotas, SSO/SAML when commissioned, dedicated support and optional regional architecture). Tenant fields record plan, billing contact, ingest/webhook quotas, retention, region, usage meters, draft invoices and SLA incidents.

Pricing, overage rates, storage/API/telemetry units, payment processor, tax treatment, contractual SLA, and support commitments require commercial approval before publication. The API exposes tenant usage/billing metadata but does not charge a customer without an integrated payment provider and executed agreement.

Onboarding provisions the tenant, membership roles, approved installation scope, expiring credentials, secrets, connector profile, quotas, contacts, training and acceptance evidence. Offboarding exports tenant data, revokes sessions/credentials, disables webhooks, archives installations, observes the contractual hold, and then requires an explicit second confirmation before hard deletion.

## External commercial blockers still pending

- Real billing provider integration (payment collection and tax)
- Executed SLA per customer (`docs/SLA_TEMPLATE.md`)
- Formal support structure with rota and escalation ownership
- Privacy documentation and DPA execution (`docs/DPA_TEMPLATE.md`)
- Final commercial terms (`docs/TERMS.md`)
- Multi-region disaster recovery execution proof
