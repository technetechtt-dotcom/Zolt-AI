# Production-readiness evidence ledger

Updated: 2026-10-26

Generated from `docs/operations/*.json`. Treat JSON artifacts as source of truth.

| Artifact | Status | Notes |
| --- | --- | --- |
| `alert-routing.json` | BLOCKED | Alertmanager is up and routes to the local alert-sink on :9095. No PagerDuty/Slack destination is configured. |
| `backup-restore-result.json` | UNREADABLE |  |
| `campaign-result.json` | UNKNOWN |  |
| `chaos-result.json` | UNREADABLE |  |
| `credential-rotation.json` | UNKNOWN |  |
| `dataset-manifest.json` | UNKNOWN |  |
| `dataset-manifest.template.json` | UNKNOWN |  |
| `evidence-summary.json` | UNKNOWN |  |
| `field-pilot.json` | BLOCKED | No customer site, GridFlex Edge Node, or USB-RS485 inverter path is attached to this workstation. Chaos recovery now PASSes locally; physical HIL, managed secrets, independent pentest and real-data gates remain required before a controlled advisory-only pilot. |
| `gridflex-pilot.json` | UNKNOWN |  |
| `hil-emulator-result.json` | PASS |  |
| `hil-gridflex-result.json` | BLOCKED | No genuine USB-RS485 adapter with a supported inverter or hardware emulator is attached. COM4 is listed but cannot be opened. COM7 remains a Huawei modem. Emulator HIL is a separate PASS and is not this physical pipeline. |
| `hil-physical-com7.json` | UNREADABLE |  |
| `load-10.json` | PASS | 1000/1000 ok |
| `load-100.json` | PASS | 10000/10000 ok |
| `load-1000.json` | PASS | 50000/50000 ok |
| `load-10000.json` | PASS | 100000/100000 ok |
| `managed-secrets.json` | BLOCKED | Set ZOLT_SECRETS_PROVIDER=aws|gcp|azure and CLI credentials to leave local AES-GCM |
| `ml-training-result.json` | PASS |  |
| `model-benchmark.json` | BLOCKED | REAL_GRIDFLEX_DATASET_UNAVAILABLE |
| `observability-deploy.json` | DEPLOYED_LOCAL |  |
| `pentest-commission.json` | NOT_COMMISSIONED |  |
| `physical-e2e-status.json` | BLOCKED | Physical path is disabled until HIL hardware is connected. Hardware execution remains hard-coded off. |
| `physical-hil-status.json` | BLOCKED | No Waveshare ESP32-S3/SIM7670X Edge Node, genuine USB-RS485 adapter, or named supported inverter is attached. Prior COM7 was a Huawei modem. Physical HIL remains unexecuted. |
| `pitr-result.json` | UNREADABLE |  |
| `queue-durability.json` | PASS |  |
| `real-data-gate.json` | BLOCKED | No named-plant dataset. Emulator scores are not accepted. |
| `reconnect-burst.json` | PASS | 6000/6000 ok |
| `security-assessment.json` | PASS |  |
| `soak-24h.json` | IN_PROGRESS | 560/560 ok |
| `soak-multiday.json` | UNKNOWN |  |
| `soak-preflight.json` | PASS | 20/20 ok |
| `soak-rehearsal.json` | PASS | 23600/23600 ok |

## Release readiness

Not ready: 12 failing or blocked artifacts.

Mandatory external items still tracked: managed secrets, alert routing, independent penetration test, physical HIL, named field pilot.

