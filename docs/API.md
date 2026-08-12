# API surface

All authenticated routes require `x-zolt-api-key` or `Authorization: Bearer <session>`.

| Method | Path | Permission |
| --- | --- | --- |
| GET | /health/live | public |
| GET | /health/ready | public |
| GET | /metrics | public |
| POST | /v1/auth/login | public |
| POST | /v1/auth/logout | authenticated |
| GET | /v1/me | authenticated |
| POST | /v1/telemetry | telemetry:write |
| GET | /v1/telemetry | telemetry:read |
| POST | /v1/analysis | recommendation:read |
| GET | /v1/recommendations | recommendation:read |
| PATCH | /v1/recommendations/:id/status | acknowledge / approve / reject |
| POST | /v1/recommendations/:id/feedback | recommendation:acknowledge |
| GET | /v1/installations | installation:read |
| GET | /v1/devices | device:read |
| GET | /v1/assets | installation:read |
| GET | /v1/users | admin:manage |
| POST | /v1/users/invite | admin:manage |
| GET | /v1/credentials | integration:manage |
| POST | /v1/credentials | integration:manage |
| POST | /v1/credentials/:id/revoke | integration:manage |
| POST | /v1/credentials/:id/rotate | integration:manage |
| GET | /v1/webhooks | webhook:manage |
| POST | /v1/webhooks | webhook:manage |
| GET | /v1/audit | audit:read |
| GET | /v1/health/system | authenticated |
| POST | /v1/copilot/ask | recommendation:read |

Gateway: `POST /v1/ingest/gridflex` requires `telemetry:write` and HMAC headers `x-zolt-signature`, `x-zolt-signature-ts`, `x-zolt-replay-key`.
