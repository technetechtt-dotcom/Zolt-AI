# GridFlex HIL test report

Status: **NOT EXECUTED ON PHYSICAL HARDWARE**.

The repository includes a read-only Modbus RTU harness (`scripts/hil-gridflex-rs485.ps1`), an inverter-emulator profile, CRC/scaling/signedness/endian tests, malformed/timeout/delay/duplicate/out-of-order/offline/reboot recovery scenarios, and an invariant that plant-control APIs remain unavailable. The harness uses function code `03` only and writes `plantControlEnabled=false` into its evidence.

Completion requires a named Edge Node, serial adapter, cable/termination details, inverter make/model/firmware, register-map revision, calibrated comparison instrument, operator/witness, timestamps, raw results, and a signed result artifact. Simulated test results must never be substituted for this report.

## Required proof fields (must be filled after execution)

- Edge node hostname / serial:
- RS485 adapter model and baud/parity/stop bits:
- Inverter make/model/firmware and supported register map revision:
- Environment (lab / pilot site):
- Test date/time (UTC):
- Operator:
- Witness:
- Commit SHA:
- Evidence artifact path (`docs/operations/hil-*.json`):

## Mandatory scenarios

- Malformed frame handling
- Delayed telemetry handling
- Duplicate telemetry handling
- Impossible value rejection
- Communication loss and recovery
- Device restart behavior
- Store-and-forward replay
- Network outage recovery
- Simulated/live separation verification
