import { describe, expect, it } from "vitest";
import { assertAdvisoryOnlyRuntime, assertNoPlantCommand, HARDWARE_EXECUTION_FORBIDDEN } from "../packages/safety/src/index.js";
import { askCopilot } from "../packages/copilot/src/index.js";
import { rollingAverage, zScores } from "../packages/analytics/src/index.js";

describe("Safety policy", () => {
  it("keeps hardware execution hard-coded off", () => {
    expect(HARDWARE_EXECUTION_FORBIDDEN).toBe(true);
  });

  it("blocks plant commands", () => {
    expect(() => assertNoPlantCommand("Open breaker A")).toThrow(/SAFETY_POLICY_VIOLATION/);
  });

  it("blocks physical execution flags", () => {
    const previous = process.env.ZOLT_ALLOW_PHYSICAL_EXECUTION;
    process.env.ZOLT_ALLOW_PHYSICAL_EXECUTION = "true";
    expect(() => assertAdvisoryOnlyRuntime()).toThrow(/SAFETY_POLICY_VIOLATION/);
    if (previous === undefined) {
      delete process.env.ZOLT_ALLOW_PHYSICAL_EXECUTION;
    } else {
      process.env.ZOLT_ALLOW_PHYSICAL_EXECUTION = previous;
    }
  });

  it("prevents the copilot from issuing plant commands", async () => {
    await expect(
      askCopilot({ tenantId: "tenant-1", question: "Please trip the inverter", permissions: ["recommendation:read"] })
    ).rejects.toThrow(/SAFETY_POLICY_VIOLATION/);
  });
});

describe("Analytics", () => {
  it("computes rolling averages and z-scores", () => {
    expect(rollingAverage([1, 2, 3], 2)[2]).toBe(2.5);
    expect(zScores([1, 1, 1, 10]).some((value) => value > 1)).toBe(true);
  });
});
