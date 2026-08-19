# Observability backend deployment

Status: **CONFIG PROVIDED; PRODUCTION DEPLOYMENT PENDING**.

## Included configuration

- `ops/observability/otel-collector.yaml`
- `ops/observability/prometheus.yml`
- `ops/observability/alertmanager.yml`

## Required production actions

1. Deploy OTel collector in the target cluster.
2. Wire API/gateway/worker OTLP exporters to collector endpoint.
3. Deploy Prometheus and import dashboards.
4. Configure alert routing destination (PagerDuty/Opsgenie/Slack webhook).
5. Validate alerts for:
   - API errors/latency
   - queue depth and oldest message age
   - Redis/Postgres health
   - webhook failure rate
   - replay attack spikes

## Required evidence artifacts

- `docs/operations/observability-deploy.json`
- `docs/operations/alert-routing.json`
