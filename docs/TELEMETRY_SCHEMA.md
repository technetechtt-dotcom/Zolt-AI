# Canonical telemetry specification

Zolt accepts canonical schema versions `1.0` and `1.1`. Unknown versions fail validation. All timestamps are ISO-8601 UTC instants; numeric measurements must be finite; `messageId` is idempotent within a tenant and installation; `simulated` is retained end to end and displayed in the Console.

## Version policy

| Version | Status    | Additions                                                       | Migration                                                                                                             |
| ------- | --------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1.0     | supported | identity, timestamps, measurements, quality                     | none                                                                                                                  |
| 1.1     | preferred | firmware, vendor/model, communication health, simulation marker | 1.0 records map missing fields to unknown and `simulated=false` only when the source is positively identified as live |

Breaking changes require a new major version and a dual-read period. Additive optional fields require a minor version. Connectors declare `supportedContractVersions` and must reject an incompatible major version.

## Quality and validation

The validator applies canonical physical ranges, then measurement-level `minimumExpected`/`maximumExpected`, then an explicitly supplied installation/asset profile. The quality assessor records completeness, measurement quality, device-clock quality, source trust, frozen/repeated readings, rapid oscillation, drift, and rate-of-change issues. Asset profiles and calibration history live in `Asset.validationProfile` and `SensorCalibration`.

## Compatibility matrix

| Connector | Connector version | Schema   | Firmware        | Verified source                                          |
| --------- | ----------------- | -------- | --------------- | -------------------------------------------------------- |
| GridFlex  | 1.0.0             | 1.0, 1.1 | profile-defined | protocol emulator tests only; physical Edge Node pending |

| Inverter profile                                  | Transport             | Scaling / signedness / endian                                         | Status                                                     |
| ------------------------------------------------- | --------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| Industrial Modbus Emulator / Zolt verification v1 | Modbus RTU over RS485 | encoded in `connectors/gridflex/profiles/industrial-emulator-v1.json` | automated decoder and CRC tests pass; physical run pending |

No physical inverter model is listed as production-supported until its signed HIL report is attached.
