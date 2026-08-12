# Secret management and rotation

## Storage

Production secrets must live in a managed secrets service (AWS Secrets Manager, GCP Secret Manager, Azure Key Vault, or equivalent). Applications receive:

- `DATABASE_URL`
- `REDIS_URL`
- `ZOLT_MASTER_KEY` (wraps signing and webhook secrets at rest)
- optional bootstrap `ZOLT_API_KEY` / `ZOLT_INGEST_HMAC_SECRET` only for first-run seed

Do not commit `.env` files. CI scans for private keys and common token patterns.

## Rotation

1. Create a new API credential in the Console or via `POST /v1/credentials`.
2. Deploy the new key to the connector.
3. Call `POST /v1/credentials/:id/rotate` or revoke the previous credential.
4. Rotate `ZOLT_MASTER_KEY` only with a planned re-encrypt of `signingSecretEnc` / webhook `secretEnc` (take a backup first).
5. Rotate webhook secrets by creating a new endpoint, dual-delivering, then disabling the old endpoint.
6. Revoke sessions after suspected account compromise (`POST /v1/auth/logout` plus password reset).

Replay keys are single-use for 10 minutes. Signing timestamps older than 5 minutes are rejected.
