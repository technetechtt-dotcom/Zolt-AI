# Penetration test report

Status: **INDEPENDENT TEST NOT COMMISSIONED OR EXECUTED**.

`pnpm pentest:commission` wrote `docs/operations/pentest-commission.json` (`NOT_COMMISSIONED`). An external firm cannot be engaged from this environment. Set `ZOLT_PENTEST_VENDOR`, `ZOLT_PENTEST_ENGAGEMENT_ID`, and `ZOLT_PENTEST_START_DATE` after the SOW is signed.

Commissioning pack: `docs/PENTEST_COMMISSIONING.md`.

Internal automated pre-assessment ran 2026-10-21 against the local API harness (`:4000`) and ingest gateway (`docs/operations/security-assessment.json`). Skipped HIGH/CRITICAL findings fail the overall assessment. This is not a substitute for an independent test.

| Finding ID | Severity | Component | Result | Residual risk |
| --- | --- | --- | --- | --- |
| PT-001 | info | API live | PASS (200 advisory-only) | Independent confirmation still required |
| PT-002 | high | Unauthenticated telemetry write | PASS (401 UNAUTHORIZED) | Independent confirmation still required |
| PT-003 | critical | Cross-tenant recommendation read | PASS (403 TENANT_MISMATCH) | Independent confirmation still required |
| PT-004 | critical | Webhook SSRF to loopback | PASS (400 WEBHOOK_URL_PORT_FORBIDDEN) | Independent confirmation still required |
| PT-005 | high | HMAC replay | PASS (first 202, second 409) | Independent confirmation still required |
| PT-006 | high | Invalid HMAC | PASS (401) | Independent confirmation still required |

## Required lifecycle

1. **Independent penetration test** (external assessor)
2. **Remediation** of all high and critical findings
3. **Retest** to verify closure

Automated repository tests and `pnpm security:assess` are defence evidence, not an independent penetration test.
