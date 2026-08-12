# Safety Case

Zolt AI is advisory-only. It receives observations, creates recommendations and records human decisions. It has no command, dispatch, actuator or Modbus-write API. Recommendation approval never triggers hardware execution. `HARDWARE_EXECUTION_FORBIDDEN` is hard-coded in `@zolt/safety`. Setting `ZOLT_ADVISORY_ONLY=false` or `ZOLT_ALLOW_PHYSICAL_EXECUTION=true` cannot enable hardware execution in this build. Future control requires a separate safety-certified control gateway, HIL validation, product-specific certification and independent review.
