import { describe, expect, it } from "vitest";
import { validateTelemetryEnvelope } from "../packages/core/src/telemetry.js";
import { createTestTelemetryEnvelope } from "./helpers/fixtures.js";

describe("Telemetry validation", () => {
  it("rejects NaN and infinite values", () => {
    const result = validateTelemetryEnvelope(
      createTestTelemetryEnvelope({
        measurements: [{ key: "powerKw", value: Number.NaN, quality: "GOOD" }],
      }),
    );
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects impossible physical ranges", () => {
    const result = validateTelemetryEnvelope(
      createTestTelemetryEnvelope({
        measurements: [
          { key: "voltage", value: 9000, unit: "V", quality: "GOOD" },
        ],
      }),
    );
    expect(result.errors.some((item) => item.includes("physical range"))).toBe(
      true,
    );
  });

  it("rejects oversized batches via schema measurement cap", () => {
    const measurements = Array.from({ length: 501 }, (_, index) => ({
      key: "powerKw",
      value: 1,
      quality: "GOOD" as const,
    }));
    const result = validateTelemetryEnvelope(
      createTestTelemetryEnvelope({ measurements }),
    );
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("flags delayed telemetry without rejecting it", () => {
    const received = new Date();
    const source = new Date(received.getTime() - 10 * 60_000);
    const result = validateTelemetryEnvelope(
      createTestTelemetryEnvelope({
        sourceTimestamp: source.toISOString(),
        receivedTimestamp: received.toISOString(),
      }),
    );
    expect(result.envelope).toBeDefined();
    expect(result.delayed).toBe(true);
  });

  it("applies installation or asset-specific physical limits", () => {
    const result = validateTelemetryEnvelope(
      createTestTelemetryEnvelope({
        measurements: [
          { key: "powerKw", value: 110, unit: "kW", quality: "GOOD" },
        ],
      }),
      undefined,
      { physicalRanges: { powerKw: { min: 0, max: 100, unit: "kW" } } },
    );
    expect(result.errors).toContain("physical range violated for powerKw");
  });
});
