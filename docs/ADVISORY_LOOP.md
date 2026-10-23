# Advisory loop

Current release: **Detect → Explain → Recommend**.

Target loop after pilot validation: **Predict → Optimise → Simulate → Human approve**.

```mermaid
flowchart LR
  T[Telemetry] --> D[Detect / forecast]
  D --> E[Explain]
  E --> R[Recommend]
  R --> S[Simulate]
  S --> H[Human approve or reject]
  H --> O[Operator acts in plant systems]
```

- `POST /v1/optimisation` returns an advisory dispatch plan.
- `POST /v1/simulate` wraps the same planner with `plantExecution: false` and `humanApprovalRequired: true`.
- Recommendation status is `PROPOSED → ACKNOWLEDGED → APPROVED | REJECTED`.
- Hardware execution is hard-coded off (`ZOLT_ADVISORY_ONLY=true`). Automatic plant execution stays outside this release.
