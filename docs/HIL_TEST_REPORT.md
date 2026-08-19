# GridFlex HIL test report

Status: **NOT EXECUTED ON PHYSICAL HARDWARE**.

The repository includes a read-only Modbus RTU harness (`scripts/hil-gridflex-rs485.ps1`), an inverter-emulator profile, CRC/scaling/signedness/endian tests, malformed/timeout/delay/duplicate/out-of-order/offline/reboot recovery scenarios, and an invariant that plant-control APIs remain unavailable. The harness uses function code `03` only and writes `plantControlEnabled=false` into its evidence.

Completion requires a named Edge Node, serial adapter, cable/termination details, inverter make/model/firmware, register-map revision, calibrated comparison instrument, operator/witness, timestamps, raw results, and a signed result artifact. Simulated test results must never be substituted for this report.
