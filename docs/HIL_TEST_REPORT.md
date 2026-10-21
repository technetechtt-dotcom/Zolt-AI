# GridFlex HIL test report

Status: **NOT EXECUTED ON PHYSICAL HARDWARE**.

High-fidelity in-process Modbus RTU emulator HIL **did execute and PASS** on 2026-10-21 (`docs/operations/hil-emulator-result.json`). Function code `03` only, `plantControlEnabled=false`, all mandatory scenarios passed: malformed CRC, delayed telemetry, duplicate store-and-forward, impossible values, communication loss/recovery, device restart, store-and-forward replay, simulated/live separation.

Physical attempt (re-run 2026-10-21T10:13Z): serial port `COM7` was present and opened. Modbus RTU 9600 8E1 function 03 **timed out** (`docs/operations/hil-physical-com7.json`). No GridFlex Edge Node or named inverter answered. Simulated/emulator results are not substituted for physical sign-off.

## Required proof fields (must be filled after execution)

- Edge node hostname / serial: _not identified_
- RS485 adapter model and baud/parity/stop bits: COM7 opened at 9600 Even 8 One; no slave response
- Inverter make/model/firmware and supported register map revision: _not identified_
- Environment (lab / pilot site): local workstation
- Test date/time (UTC): 2026-10-21T09:50:30Z
- Operator: local campaign runner
- Witness: none
- Commit SHA: working tree
- Evidence artifact path (`docs/operations/hil-*.json`): `docs/operations/hil-emulator-result.json`, `docs/operations/hil-physical-com7.json`

## Mandatory scenarios

- Malformed frame handling — PASS (emulator)
- Delayed telemetry handling — PASS (emulator)
- Duplicate telemetry handling — PASS (emulator)
- Impossible value rejection — PASS (emulator)
- Communication loss and recovery — PASS (emulator)
- Device restart behavior — PASS (emulator)
- Store-and-forward replay — PASS (emulator)
- Network outage recovery — PASS (emulator)
- Simulated/live separation verification — PASS (emulator)
