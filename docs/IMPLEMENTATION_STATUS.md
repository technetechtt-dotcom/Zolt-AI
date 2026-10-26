# Implementation status (generated)

Generated: 2026-10-26T12:25:31.025Z

This file is generated from `docs/operations/*.json` by `pnpm evidence:aggregate`. Do not edit by hand.

| Artifact | Status | Notes |
| --- | --- | --- |
| `alert-routing.json` | LIVE_LOCAL_SINK | Alertmanager is up and routes to the local alert-sink on :9095. No PagerDuty/Slack destination is configured. |
| `backup-restore-result.json` | PASS |  |
| `campaign-result.json` | FAIL | hil-emulator:PASS; physical-hil-com7:FAIL; load-10:PASS; load-100:PASS; load-1000:PASS; load-10000:PASS; reconnect-burst:PASS; soak-rehearsal:PASS; soak-24h:STARTED; soak-multiday:STARTED; chaos-redis:SKIPPED; chaos-postgres:SKIPPED; backup-restore:SKIPPED; pitr:SKIPPED; observability-compose:SKIPPED; managed-secrets-rotate:PASS; security-assessment:PASS; ml-train-validate:PASS; optimisation-horizon:PASS; controlled-pilot:PASS |
| `chaos-result.json` | PASS |  |
| `credential-rotation.json` | BLOCKED | No AWS Secrets Manager, Azure Key Vault, or GCP Secret Manager is configured. Staging/pilot credentials cannot be rotated through a managed backend until ZOLT_SECRETS_PROVIDER is set. |
| `dataset-manifest.json` | ENGINEERING | emulator/synthetic dataset; not a named plant |
| `dataset-manifest.template.json` | TEMPLATE |  |
| `evidence-summary.json` | META | aggregator output |
| `field-pilot.json` | BLOCKED | No customer site, GridFlex Edge Node, or USB-RS485 inverter path is attached to this workstation. Chaos recovery now PASSes locally; physical HIL, managed secrets, independent pentest and real-data gates remain required before a controlled advisory-only pilot. |
| `go-no-go.json` | NO-GO | Production go requires physical HIL PASS, soak PASS, multi-day PASS, Redis durability PASS, managed secrets PASS, staging monitoring PASS, external pentest PASS/retested, real-data gate PASS or an explicitly AI-limited pilot scope, signed customer documents, and green release CI. |
| `gridflex-pilot.json` | ENGINEERING | controlled emulator pilot; no named plant |
| `hil-emulator-result.json` | PASS |  |
| `hil-gridflex-result.json` | FAIL | No genuine USB-RS485 adapter with a supported inverter or hardware emulator is attached. COM4 is listed but cannot be opened. COM7 remains a Huawei modem. Emulator HIL is a separate PASS and is not this physical pipeline. |
| `hil-physical-com7.json` | FAIL |  |
| `load-10.json` | PASS | 1000/1000 ok |
| `load-100.json` | PASS | 10000/10000 ok |
| `load-1000.json` | PASS | 50000/50000 ok |
| `load-10000.json` | PASS | 100000/100000 ok |
| `managed-secrets.json` | BLOCKED | Set ZOLT_SECRETS_PROVIDER=aws/gcp/azure and CLI credentials to leave local AES-GCM |
| `ml-training-result.json` | PASS |  |
| `model-benchmark.json` | FAIL | REAL_GRIDFLEX_DATASET_UNAVAILABLE |
| `observability-deploy.json` | DEPLOYED_LOCAL | Host ports remapped around GridFlex (Prometheus 9096, Grafana 3002). This is not a production cluster or a real pager destination. |
| `pentest-commission.json` | NOT_COMMISSIONED | An independent firm cannot be contracted from this environment. Set ZOLT_PENTEST_VENDOR, ZOLT_PENTEST_ENGAGEMENT_ID, and ZOLT_PENTEST_START_DATE after the SOW is signed. |
| `pentest-scope.json` | NOT_COMMISSIONED | Internal security-assessment.json is not a substitute for an independent firm. |
| `physical-e2e-status.json` | BLOCKED | Physical path is disabled until HIL hardware is connected. Hardware execution remains hard-coded off. |
| `physical-hil-status.json` | FAIL | No Waveshare ESP32-S3/SIM7670X Edge Node, genuine USB-RS485 adapter, or named supported inverter is attached. Prior COM7 was a Huawei modem. Physical HIL remains unexecuted. |
| `physical-rs485-commissioning.json` | FAIL | No Waveshare ESP32-S3/SIM7670X Edge Node, genuine USB-RS485 path, or named inverter is attached. COM7 previously enumerated as a Huawei modem. Plant control remains disabled. |
| `pitr-result.json` | PASS |  |
| `queue-durability.json` | PASS |  |
| `real-data-gate.json` | FAIL | No named-plant dataset. Emulator scores are not accepted. |
| `reconnect-burst.json` | PASS | 6000/6000 ok |
| `security-assessment.json` | PASS |  |
| `soak-24h-interrupted.json` | INTERRUPTED | HARNESS_STOPPED_CHECKPOINTING |
| `soak-24h.json` | IN_PROGRESS | 200/200 ok |
| `soak-latency-after-cache.json` | ROOT_CAUSE | After credential/identity caching, P95 fell from 832 ms to ~50 ms. This burst (~140 msg/s) was stopped so the 24h soak can run at a sustainable ~8-10 msg/s and not dominate database growth. |
| `soak-latency-investigation.json` | ROOT_CAUSE |  |
| `soak-latency-probe.json` | PASS | 200/200 ok |
| `soak-multiday.json` | QUEUED | 72-hour mixed-traffic soak starts only after the 24-hour soak reaches 1440 minutes with strengthened pass criteria. It has not started. |
| `soak-preflight.json` | PASS | 20/20 ok |
| `soak-rehearsal.json` | PASS | 23600/23600 ok |

## Release readiness

Not ready: 14 failing or blocked artifacts.

Mandatory external items still tracked: managed secrets, alert routing, independent penetration test, physical HIL, named field pilot.

