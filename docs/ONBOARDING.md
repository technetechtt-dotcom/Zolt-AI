# Customer onboarding wizard (tenant administrator)

1. Create tenant, product and installation identities.
2. Select inverter vendor/model/firmware from the compatibility matrix.
3. Provision a GridFlex connector credential scoped to that installation with `telemetry:write`.
4. Record Edge Node serial, USB-RS485 adapter, slave ID, baud/parity/stop bits and register-map revision.
5. Invite named users; require MFA before production.
6. Configure alert destinations (email/Teams/Slack plus PagerDuty/Opsgenie for P1).
7. Run the commissioning checklist: ingest 202s, Console live telemetry, recommendation workflow, advisory-only confirmation.

The Console does not yet ship a multi-step React wizard; the API and Command Centre cover the same steps.
