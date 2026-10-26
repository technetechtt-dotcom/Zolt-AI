# Model governance

Every production model requires a model card with:

- Training dataset version and feature version
- Evaluation results and holdout period
- Owner and approver
- Deployment date
- Champion / challenger status
- Drift thresholds
- Rollback procedure
- Automatic disablement when performance degrades below the fail-closed gate

The real-data gate remains fail-closed until a named plant dataset exists. Emulator scores cannot qualify production AI.
