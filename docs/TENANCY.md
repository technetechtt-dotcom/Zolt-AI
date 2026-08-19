# Tenancy model

Every Product belongs to one Tenant (`@@unique([id, tenantId])` plus composite foreign keys).
Every ProductInstallation belongs to one Tenant and one Product of that tenant.
Devices/assets reference `(installationId, tenantId)`; telemetry/recommendations/credentials reference `(installationId, tenantId, productId)`, so neither a tenant nor a product can be mismatched.

API credentials are always bound to a tenant and may also be bound to a product and/or installation. Request `tenantId` / `productId` / `installationId` values are compared to the authenticated principal. Changing `tenantId` in a payload cannot access another tenant.

Human authority lives only on `TenantMembership`. `MembershipRole` joins `(tenantId,userId)` to a role from the same tenant; sessions and installation grants also reference that composite membership. A single user may therefore be administrator in tenant A and analyst in tenant B without global-role inheritance. Non-administrator session queries are filtered to explicit installation grants and object-ID routes recheck access. Service accounts and devices use lifecycle-managed credential kinds. The `device` role may only write telemetry.
