# Observability backend deployment

Status: **DEPLOYED LOCALLY** on 2026-10-22. Not a production cluster.

| Component | URL |
| --- | --- |
| Prometheus | http://localhost:9096 |
| Grafana | http://localhost:3002 (admin `zolt` / `zolt`) |
| Alertmanager | http://localhost:9093 |
| Alert sink | http://localhost:9095/health |
| OTel collector | http://localhost:4317 (gRPC), :4318 (HTTP) |

Prometheus scrapes `host.docker.internal:4000` and `:4001` `/metrics`. Alertmanager posts to `http://alert-sink:9095/alerts`. Host ports are remapped via `ZOLT_PROMETHEUS_PORT` / `ZOLT_GRAFANA_PORT` because GridFlex already binds 9090 and 3000.

## Required production actions

1. Deploy OTel collector in the target cluster.
2. Wire API/gateway/worker OTLP exporters to collector endpoint.
3. Deploy Prometheus and import dashboards.
4. Configure alert routing destination (PagerDuty/Opsgenie/Slack webhook).
5. Validate alerts for API errors/latency, queue depth, Redis/Postgres health, webhook failure rate, replay attack spikes.
