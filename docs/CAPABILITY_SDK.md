# Capability SDK

Skills implement `ZoltSkill` from `@zolt/capability-sdk`. They receive tenant-bound telemetry and must return explainable recommendations with evidence, assumptions, uncertainties, confidence breakdowns and a non-controlling proposed action.

`AnalysisOrchestrator` calibrates confidence, blocks plant-command language, and downgrades critical recommendations when data quality is poor. Physical execution is hard-coded off.

See `capability-packs/energy` for the energy pack.
