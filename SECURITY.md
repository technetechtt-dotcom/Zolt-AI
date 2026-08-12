# Security Policy

## Advisory-only product

Zolt AI does not execute plant commands. Reports of control-plane bypasses are treated as critical.

## Vulnerability disclosure

Email security reports to security@zolt.example with:

- affected component and version / commit
- reproduction notes that do not include live customer data
- impact assessment (auth bypass, tenant isolation, replay, secret exposure)

Do not open public GitHub issues for unpatched critical vulnerabilities.

We aim to acknowledge reports within 5 business days and to provide a remediation plan within 30 days for confirmed issues.

## Production requirements

- `NODE_ENV=production`
- `ZOLT_ADVISORY_ONLY=true`
- `ZOLT_ALLOW_INSECURE_AUTH` must be unset
- TLS terminated (`ZOLT_TLS_TERMINATED=true`)
- Database-backed credentials; hashed keys only
- Redis required for replay protection
- Secrets stored in a managed secrets service, not in git
