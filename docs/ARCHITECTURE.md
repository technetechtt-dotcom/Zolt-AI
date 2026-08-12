# Architecture

```mermaid
flowchart LR
  GF[GridFlex AI] --> GW[Connector Gateway]
  HW[Future hardware/products] --> GW
  GW --> C[Canonical contracts]
  C --> Q[Processing queue]
  Q --> CORE[Zolt Core]
  CORE --> PACKS[Capability packs]
  PACKS --> REC[Explainable recommendations]
  REC --> API[Zolt API / Webhooks / SDK]
```

Zolt Core is product-neutral. Vendor mappings remain in connectors. Domain intelligence remains in capability packs. Physical execution is outside the platform.

## Applications

- `apps/api` — query, analysis, RBAC, credentials, webhooks, copilot
- `apps/connector-gateway` — signed GridFlex ingest
- `apps/worker` — persist telemetry, run skills, deliver webhooks
- `apps/console` — operator UI

## Data integrity

Composite foreign keys bind installations to `(productId, tenantId)` and bind devices, assets, telemetry and recommendations to `(installationId, tenantId)`. Status fields use PostgreSQL enums.

