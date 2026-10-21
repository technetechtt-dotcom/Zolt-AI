import { describe, expect, it } from "vitest";
import { scoreFindings, type Finding } from "../scripts/security-assessment.js";

describe("security assessment scoring", () => {
  it("fails when a high or critical check is skipped", () => {
    const findings: Finding[] = [
      {
        id: "PT-002",
        severity: "high",
        title: "unauth",
        result: "SKIP",
        detail: "status=0",
      },
      {
        id: "PT-005",
        severity: "high",
        title: "replay",
        result: "PASS",
        detail: "ok",
      },
    ];
    expect(scoreFindings(findings).result).toBe("FAIL");
    expect(scoreFindings(findings).skippedHighOrCritical).toEqual(["PT-002"]);
  });

  it("passes only when every high and critical check executed and passed", () => {
    const findings: Finding[] = [
      { id: "PT-001", severity: "info", title: "live", result: "PASS", detail: "" },
      { id: "PT-002", severity: "high", title: "unauth", result: "PASS", detail: "" },
      { id: "PT-003", severity: "critical", title: "tenant", result: "PASS", detail: "" },
      { id: "PT-004", severity: "critical", title: "ssrf", result: "PASS", detail: "" },
      { id: "PT-005", severity: "high", title: "replay", result: "PASS", detail: "" },
      { id: "PT-006", severity: "high", title: "hmac", result: "PASS", detail: "" },
    ];
    expect(scoreFindings(findings)).toEqual({
      failed: [],
      skippedHighOrCritical: [],
      result: "PASS",
    });
  });
});
