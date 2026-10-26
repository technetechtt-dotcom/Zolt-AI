# Zolt AI commercial pilot package

Advisory-only industrial intelligence. Zolt observes, analyses, simulates and recommends. It does not issue plant commands in this release.

## Pilot SLA

| Item | Target |
| --- | --- |
| Service hours | 07:00–19:00 SAST on business days, plus P1 after-hours for safety-critical advisory outages |
| Availability | 99.5% excluding agreed maintenance windows |
| Advisory latency | P95 recommendation availability under 15 minutes from ingested telemetry |
| P1 response | 1 hour |
| P2 response | 4 business hours |
| P3 response | 1 business day |
| Data loss RPO | 5 minutes (PostgreSQL WAL + Redis AOF) |
| Restore RTO | 30 minutes |
| Plant control | None. Hardware execution remains hard-coded off |

Credits apply only when Zolt itself is unavailable. Connector or plant outages are excluded.

## Onboarding

1. Named site, tenant, product and installation identities.
2. GridFlex Edge Node, USB-RS485 path, inverter make/model/firmware, slave ID, baud/parity, register map revision.
3. Advisory-only confirmation signed by the customer operator.
4. Console users invited with MFA; platform developer accounts stay with Zolt.
5. Telemetry, alarm, weather, export-limit and maintenance feeds listed in the data schedule.
6. Customer acceptance against the criteria below before go-live.

## Support escalation

| Level | Owner | When |
| --- | --- | --- |
| L1 | Zolt support | Console access, user invites, ingestion errors |
| L2 | Platform developer (`platform-administrator`) | Queue, database, connector, model health |
| L3 | Engineering on-call | Safety policy, tenancy isolation, data integrity |
| Customer plant | Customer operations | Any request to dispatch equipment — Zolt will refuse |

Escalate P1 by phone and the agreed notification destination (email/Slack/Teams webhook wired in Alertmanager).

## Data processing agreement (summary)

- Roles: customer is the responsible party; Zolt is the operator processing telemetry and operator decisions for advisory analysis.
- Purpose: ingest, analyse, recommend, report. No sale of personal information. No plant actuation.
- Location: region selected at tenant create (`af-south-1` default).
- Retention: telemetry 90 days, recommendations 365 days, audit 7 years unless the tenant sets stricter limits.
- Sub-processors: managed PostgreSQL, Redis, secrets manager, observability backend named in the order form.
- Breach notification: 72 hours after Zolt confirms a personal-information incident.
- Return/deletion: export via `GET /v1/tenant/export`, then offboard.

This summary does not replace counsel-reviewed DPA wording.

## Privacy / POPIA procedures

1. Lawful basis: legitimate interest in plant reliability plus operator consent for named user accounts.
2. Minimum collection: operational telemetry, inverter alarms, weather, export limits, maintenance events, operator decisions. No special personal information.
3. Access: tenant-scoped RBAC; platform operators are named, audited and unscoped by design.
4. Operator rights: access, correction, deletion of user accounts; site export on request.
5. Transfer: no cross-border transfer without the customer’s written instruction.
6. Operator training: Console sign-in with MFA; no shared passwords.

## Customer acceptance criteria

- [ ] Advisory-only banner visible in Console
- [ ] Physical or accepted emulator HIL for the named inverter
- [ ] Chaos recovery of API, gateway and worker within 60 seconds without operator restart
- [ ] Staging Prometheus/Grafana/Alertmanager scraping live services
- [ ] Secrets in a managed backend; rotated credentials reject old values
- [ ] Named users can acknowledge/approve/reject recommendations
- [ ] No plant-command API present
- [ ] Pilot success report template completed after 30 days

## Pilot success report template

- Site, period, advisory-only confirmation
- Telemetry volume, simulated vs live split
- Recommendation counts by severity and decision
- Estimated recovered energy / revenue (advisory, not settled)
- Incidents, RPO/RTO evidence, chaos and soak pointers
- Model scores vs the fail-closed real-data gate (forecast, curtailment, anomaly, comms failure)
- Customer decision: continue, expand, or stop
- Explicit statement that automatic plant execution remains out of scope

## Billing plans (commercial, not yet invoiced live)

| Plan | Sites | Devices | Messages / month | Storage | Support |
| --- | --- | --- | --- | --- | --- |
| Pilot | 1 | 25 | 2,000,000 | 25 GB | email |
| Standard | 25 | 500 | 40,000,000 | 500 GB | business hours |
| Enterprise | contract | contract | contract | contract | 24×7 |

Overage for extra sites, devices, API calls and model features is quoted. Billing provider is invoice until a payment processor is connected. Signed SLA/DPA/order form/privacy terms still require legal counsel.
