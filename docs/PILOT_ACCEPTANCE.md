# Formal pilot acceptance criteria

Scope is **advisory only**. Zolt must not write inverter setpoints or plant commands.

| Criterion | Threshold |
| --- | --- |
| Ingestion availability | ≥ 99.5% during the 30-day window |
| Physical HIL | PASS on named Edge Node + inverter |
| Alert delivery | P1 reaches pager/email; acknowledgement recorded |
| Telemetry loss | < 0.1% silent loss after reconnect/store-and-forward |
| Recommendation latency | P95 < 30 s from accepted telemetry to visible advisory |
| Forecast accuracy | Fail-closed until real named-plant holdout exists |
| Operator acceptance | ≥ 70% of reviewed advisories marked useful or correctly rejected with reason |
| Uptime | ≥ 99.5% excluding planned maintenance |
| Support response | P1 < 1 hour, P2 < 8 business hours |
| Safety | Hardware execution remains disabled |

A 30-day controlled advisory pilot starts only after physical HIL, managed secrets, independent pen test, and staging infrastructure are ready.
