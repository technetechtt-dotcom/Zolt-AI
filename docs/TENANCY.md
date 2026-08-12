# Tenancy model

Every Product belongs to one Tenant (`@@unique([id, tenantId])` plus composite foreign keys).
Every ProductInstallation belongs to one Tenant and one Product of that tenant.
Devices, assets, telemetry and recommendations reference `(installationId, tenantId)` so a mismatched ID cannot attach data to another tenant.

API credentials are always bound to a tenant and may also be bound to a product and/or installation. Request `tenantId` / `productId` / `installationId` values are compared to the authenticated principal. Changing `tenantId` in a payload cannot access another tenant.

Human users have memberships, roles and optional installation-level access. Service accounts and devices are separate identity kinds. The `device` role may only write telemetry.
