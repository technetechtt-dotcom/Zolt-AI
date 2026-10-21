# Observability backend deployment

Status: **CONFIG READY; ENGINE NOT RUNNING**. Compose now includes Prometheus, Grafana, OTel collector, Alertmanager, and an alert-sink used for alert routing.

## Included configuration

- `ops/observability/otel-collector.yaml`
- `ops/observability/prometheus.yml`
- `ops/observability/prometheus-alerts.yml`
- `ops/observability/alertmanager.yml`
- `ops/observability/grafana/`
- `ops/observability/alert-sink.mjs`

Bring up with `pnpm obs:up` once Docker Desktop is healthy. Prometheus scrapes `host.docker.internal:4000` and `:4001` `/metrics`. Alertmanager posts to `http://alert-sink:9095/alerts`.

## Required production actions

1. Deploy OTel collector in the target cluster.
2. Wire API/gateway/worker OTLP exporters to collector endpoint.
3. Deploy Prometheus and import dashboards.
4. Configure alert routing destination (PagerDuty/Opsgenie/Slack webhook).
5. Validate alerts for API errors/latency, queue depth, Redis/Postgres health, webhook failure rate, replay attack spikes.

## Required evidence artifacts

- `docs/operations/observability-deploy.json`
- `docs/operations/alert-routing.json`
