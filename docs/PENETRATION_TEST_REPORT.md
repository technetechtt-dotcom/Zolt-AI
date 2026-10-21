# Penetration test report

Status: **INDEPENDENT TEST NOT COMMISSIONED OR EXECUTED**.

Commissioning pack: `docs/PENTEST_COMMISSIONING.md`.

Internal automated pre-assessment ran 2026-10-21 against the local ingest gateway (`docs/operations/security-assessment.json`):

| Finding ID | Severity | Component | Result | Residual risk |
| --- | --- | --- | --- | --- |
| PT-005 | high | HMAC replay | PASS (first 202, second 409) | Independent confirmation still required |
| PT-006 | high | Invalid HMAC | PASS (401) | Independent confirmation still required |
| PT-001–PT-004 | info–critical | API surface | SKIP (API process not running) | Independent test still required |

## Required lifecycle

1. **Independent penetration test** (external assessor)
2. **Remediation** of all high and critical findings
3. **Retest** to verify closure

Automated repository tests and `pnpm security:assess` are defence evidence, not an independent penetration test.
