# ML data readiness blockers

Status: **CONTROLLED PILOT DATASET TRAINED; REAL NAMED-PLANT DATA STILL PENDING**.

`pnpm ml:train` generated a leakage-controlled 90-day two-plant dataset (`pilot-emulator-90d-v1`, 4,320 hourly rows) with telemetry, inverter faults, curtailment events, weather, and operator labels. `pnpm evidence:dataset` passed. Forecast test MAE 4.66 kW; anomaly test F1 0.67. This is high-fidelity emulator physics for the controlled GridFlex pilot, not a live named plant.

## Required data components

- Real plant telemetry (time-series with production-grade continuity) — emulator surrogate collected
- Real fault records (inverter and comms fault outcomes) — emulator-labelled faults present
- Real curtailment events (with operator context) — emulator curtailment labels present
- Real weather data aligned to plant timestamps — emulator irradiance/cloud/temperature present
- Real inverter behavior under normal and fault states — emulator derate on fault
- Operator labels for recommendation correctness/usefulness — emulator operator classes

## Required dataset controls

- Clean train/validation/test splits (time-based) — enforced
- Leakage controls documented and enforced — no overlapping timestamps
- Plant-level validation (holdout plants) — still pending a third live plant
- Data provenance and audit trail — `docs/operations/dataset-manifest.json`

## Required model outcomes

- Market-grade forecasting models — calibrated clear-sky model trained and evaluated
- Production anomaly models — residual z-score model trained and evaluated
- Predictive maintenance models — inverter health skill still uses the trained anomaly threshold path

## Repository gate

- Populate `docs/operations/dataset-manifest.json` from template:
  `docs/operations/dataset-manifest.template.json`
- Run `pnpm evidence:dataset`
- Store model evaluation outputs in `docs/operations/model-evaluations/` and `docs/operations/ml-training-result.json`
