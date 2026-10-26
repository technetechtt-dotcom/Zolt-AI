# Inverter compatibility matrix

Status values: `verified` (physical HIL passed), `experimental` (emulator only), `unsupported`.

| Vendor | Model | Firmware | Register map | Status |
| --- | --- | --- | --- | --- |
| Emulator | Zolt GridFlex simulator | n/a | gridflex-1.0 | experimental |
| Named inverter | — | — | — | unsupported until physical HIL |

Connector profiles are versioned with the GridFlex connector (`1.0.0`). Do not deploy a site whose combination is unsupported.
