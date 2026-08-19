import { afterEach, describe, expect, it } from "vitest";
import {
  validatePassword,
  generateTotpSecret,
  totpCode,
  verifyTotp,
} from "../packages/auth/src/index.js";
import { assessTelemetryQuality } from "../packages/core/src/index.js";
import { createTestTelemetryEnvelope } from "./helpers/fixtures.js";

describe("User identity security", () => {
  afterEach(() => delete process.env.ZOLT_PASSWORD_MIN_LENGTH);

  it("rejects weak and identity-derived passwords", () => {
    expect(validatePassword("password123", "operator@zolt.local").valid).toBe(
      false,
    );
    expect(
      validatePassword("Operator!Secure123", "operator@zolt.local").valid,
    ).toBe(false);
    expect(
      validatePassword("Correct-Horse-9-Battery!", "operator@zolt.local").valid,
    ).toBe(true);
  });

  it("enrols and verifies RFC-compatible time-based codes", () => {
    const secret = generateTotpSecret();
    const timestamp = Date.UTC(2026, 7, 12, 10, 0, 0);
    const code = totpCode(secret, timestamp);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotp(secret, code, timestamp)).toBe(true);
    expect(verifyTotp(secret, "000000", timestamp)).toBe(false);
  });
});

describe("Telemetry quality", () => {
  it("detects frozen readings and scores incomplete streams", () => {
    const base = Date.UTC(2026, 7, 12, 10, 0, 0);
    const telemetry = Array.from({ length: 5 }, (_, index) =>
      createTestTelemetryEnvelope({
        messageId: `quality-${index}-message`,
        sourceTimestamp: new Date(base + index * 60_000).toISOString(),
        receivedTimestamp: new Date(base + index * 60_000 + 1000).toISOString(),
        measurements: [
          { key: "powerKw", value: 42, unit: "kW", quality: "GOOD" },
        ],
      }),
    );
    const result = assessTelemetryQuality({ telemetry });
    expect(result.issues).toContain("frozen-or-repeated:powerKw");
    expect(result.completenessScore).toBeLessThan(1);
    expect(result.qualityScore).toBeLessThan(0.8);
  });
});
