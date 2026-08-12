export const HARDWARE_EXECUTION_FORBIDDEN = true;

export function assertAdvisoryOnlyRuntime(): void {
  if (process.env.ZOLT_ADVISORY_ONLY === "false" && process.env.ZOLT_ALLOW_PHYSICAL_EXECUTION === "true") {
    throw new Error("SAFETY_POLICY_VIOLATION: physical execution is forbidden in this build");
  }
  if (HARDWARE_EXECUTION_FORBIDDEN && process.env.ZOLT_ALLOW_PHYSICAL_EXECUTION === "true") {
    throw new Error("SAFETY_POLICY_VIOLATION: hardware execution is hard-coded off for pilots");
  }
}

export function assertNoPlantCommand(action: string): void {
  const forbidden = /(open breaker|close breaker|trip|dispatch|actuate|modbus write|setpoint write)/i;
  if (HARDWARE_EXECUTION_FORBIDDEN && forbidden.test(action)) {
    throw new Error("SAFETY_POLICY_VIOLATION: plant command blocked");
  }
}

export function productionAdvisoryDefault(): boolean {
  return process.env.ZOLT_ADVISORY_ONLY !== "false";
}

export function isHighRisk(severity: string, safetyClass?: string): boolean {
  return severity === "CRITICAL" || safetyClass === "high-risk";
}
