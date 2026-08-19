# Incident response

Roles: Incident Commander owns decisions; Operations Lead restores service; Security Lead contains and investigates; Communications Lead handles customer/regulator notices; Scribe preserves the timeline. Populate the on-call names and out-of-band contacts in the production secret store, not this repository.

| Severity | Definition                                       | Initial response  |
| -------- | ------------------------------------------------ | ----------------- |
| SEV-1    | safety risk, confirmed tenant leak, broad outage | 15 minutes        |
| SEV-2    | material single-tenant impact or degraded ingest | 30 minutes        |
| SEV-3    | limited impact with workaround                   | 4 hours           |
| SEV-4    | low-impact defect/request                        | next business day |

Contain, preserve evidence, revoke affected credentials/sessions, restore from known-good state, validate tenant isolation and advisory-only controls, notify customers according to contract, assess POPIA notification duties, and run a blameless review within five business days. The review records timeline, impact, root cause, contributing conditions, response effectiveness, corrective actions/owners/dates, and evidence of retest.
