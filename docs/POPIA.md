# POPIA and data lifecycle

- Telemetry and recommendations carry tenant IDs and retention days on the Tenant record.
- Soft-delete/archive columns exist on tenants, installations, devices, assets, telemetry and recommendations.
- Tenant offboarding: call the export workflow, verify the artifact, then archive the tenant and revoke sessions/credentials/webhooks. Hard deletion requires the tenant already be offboarded and an explicit second confirmation.
- Account deletion: archive the user, revoke sessions, and retain audit events for the lawful retention period.
- Access reviews: list users, memberships/roles, installation grants, sessions, dormant accounts and credentials quarterly; revoke unused access.
- The automated retention job archives telemetry/recommendations and deletes audit events only after each tenant's configured lawful retention period.
- Use `PRIVACY.md`, `TERMS.md` and the incident process as templates; complete Information Officer, subprocessors, cross-border safeguards and executed DPA terms before production.
- Do not store special personal information in telemetry payloads.
