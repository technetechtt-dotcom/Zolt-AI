# Energy rule registry

Every energy skill exposes an immutable ID and version in recommendation output. Thresholds resolve in this order: site/asset rule ID, measurement key, manufacturer rule ID, manufacturer measurement key, packaged default. Every recommendation records evidence, assumptions, uncertainty, confidence breakdown, rule/model version, and the input snapshot ID.

The deterministic pack covers telemetry health, communications, sensor quality/drift, voltage/frequency/power-factor anomalies, export constraints, curtailment, production/load forecasts, grid congestion, inverter efficiency/underperformance, loss, battery/storage/flexible-load opportunities, carbon impact, and predictive-maintenance advisories. `production-forecast-model` includes irradiance, cloud cover, temperature derating, a clear-sky baseline, and a 95% interval. `revenue-loss-model` compares an advisory multi-objective storage/load/hydrogen plan with the current-operation baseline.

These rules are pilot heuristics until validated against signed plant datasets. A rule must not be described as plant-validated solely because its regression tests pass.
