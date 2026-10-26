import { describe, expect, it } from "vitest";
import {
  evaluateSoakPreflight,
  soakPassed,
  soakShouldAbort,
} from "../scripts/lib/soak-policy.js";

describe("soak policy", () => {
  it("refuses to start unless every preflight sample is 202", () => {
    const ok = Array.from({ length: 20 }, () => ({ ok: true, status: 202 }));
    expect(evaluateSoakPreflight(ok).ok).toBe(true);
    expect(
      evaluateSoakPreflight([...ok.slice(0, 19), { ok: false, status: 403 }]).ok,
    ).toBe(false);
  });

  it("aborts after the failure threshold", () => {
    expect(soakShouldAbort({ messages: 50, failed: 20 })).toBe(false);
    expect(soakShouldAbort({ messages: 200, failed: 1, threshold: 0.001 })).toBe(
      true,
    );
    expect(soakShouldAbort({ messages: 2000, failed: 1, threshold: 0.001 })).toBe(
      false,
    );
  });

  it("does not treat a zero-success artifact as a completed 24h soak", () => {
    expect(
      soakPassed({
        inProgress: false,
        durationMs: 1440 * 60_000,
        messages: 200,
        successful: 0,
        failed: 200,
        targetMinutes: 1440,
      }),
    ).toBe(false);
  });

  it("fails a completed soak that exceeds P95 or heap growth", () => {
    expect(
      soakPassed({
        inProgress: false,
        durationMs: 1440 * 60_000,
        messages: 10_000,
        successful: 10_000,
        failed: 0,
        targetMinutes: 1440,
        p95Ms: 1800,
        p99Ms: 400,
      }),
    ).toBe(false);
    expect(
      soakPassed({
        inProgress: false,
        durationMs: 1440 * 60_000,
        messages: 10_000,
        successful: 10_000,
        failed: 0,
        targetMinutes: 1440,
        p95Ms: 400,
        p99Ms: 500,
        growingHeap: true,
      }),
    ).toBe(false);
  });

  it("passes a completed soak within bounded latency and resources", () => {
    expect(
      soakPassed({
        inProgress: false,
        durationMs: 1440 * 60_000,
        messages: 10_000,
        successful: 10_000,
        failed: 0,
        targetMinutes: 1440,
        p95Ms: 400,
        p99Ms: 500,
        heapGrowthMb: 8,
        rssMb: 90,
        queueAgeMs: 120,
        dlqCount: 0,
        duplicateRecommendations: 0,
        workerLag: 0,
      }),
    ).toBe(true);
  });
});
