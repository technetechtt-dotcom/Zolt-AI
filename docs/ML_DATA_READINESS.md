# ML data readiness blockers

Status: **PENDING REAL PLANT DATA**.

The main technical blocker to mature production AI is no fully approved real-world labeled dataset yet.

## Required data components

- Real plant telemetry (time-series with production-grade continuity)
- Real fault records (inverter and comms fault outcomes)
- Real curtailment events (with operator context)
- Real weather data aligned to plant timestamps
- Real inverter behavior under normal and fault states
- Operator labels for recommendation correctness/usefulness

## Required dataset controls

- Clean train/validation/test splits (time-based)
- Leakage controls documented and enforced
- Plant-level validation (holdout plants)
- Data provenance and audit trail

## Required model outcomes

- Market-grade forecasting models
- Production anomaly models
- Predictive maintenance models

## Repository gate

- Populate `docs/operations/dataset-manifest.json` from template:
  `docs/operations/dataset-manifest.template.json`
- Run `pnpm evidence:dataset`
- Store model evaluation outputs in `docs/operations/model-evaluations/`
