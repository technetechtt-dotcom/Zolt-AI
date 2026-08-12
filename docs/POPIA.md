# POPIA and data lifecycle

- Telemetry and recommendations carry tenant IDs and retention days on the Tenant record.
- Soft-delete/archive columns exist on tenants, installations, devices, assets, telemetry and recommendations.
- Tenant offboarding: export recommendations, audit, telemetry metadata, then archive the tenant (`archivedAt`) and revoke credentials and sessions.
- Account deletion: archive the user, revoke sessions, and retain audit events for the lawful retention period.
- Access reviews: list `/v1/users` and `/v1/credentials` quarterly; revoke unused keys.
- Do not store special personal information in telemetry payloads.
