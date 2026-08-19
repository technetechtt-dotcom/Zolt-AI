export const HARDWARE_EXECUTION_FORBIDDEN = true;

export function assertAdvisoryOnlyRuntime(): void {
  if (
    process.env.ZOLT_ADVISORY_ONLY === "false" &&
    process.env.ZOLT_ALLOW_PHYSICAL_EXECUTION === "true"
  ) {
    throw new Error(
      "SAFETY_POLICY_VIOLATION: physical execution is forbidden in this build",
    );
  }
  if (
    HARDWARE_EXECUTION_FORBIDDEN &&
    process.env.ZOLT_ALLOW_PHYSICAL_EXECUTION === "true"
  ) {
    throw new Error(
      "SAFETY_POLICY_VIOLATION: hardware execution is hard-coded off for pilots",
    );
  }
}

export function assertNoPlantCommand(action: string): void {
  const forbidden =
    /\b(?:open|close)(?:\s+the)?\s+breaker\b|\b(?:trip|dispatch|actuate)\b|\bmodbus\s+write\b|\bsetpoint\s+write\b/i;
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
