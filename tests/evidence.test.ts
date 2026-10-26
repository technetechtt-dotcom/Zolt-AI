import { describe, expect, it } from "vitest";
import {
  interpretEvidence,
  parseEvidenceJson,
} from "../scripts/lib/evidence.js";

describe("evidence aggregator", () => {
  it("parses UTF-16 LE with BOM", () => {
    const json = '{"result":"PASS","reason":"restored"}';
    const buffer = Buffer.from(`\uFEFF${json}`, "utf16le");
    const parsed = parseEvidenceJson(buffer);
    expect(parsed.result).toBe("PASS");
    expect(interpretEvidence("backup-restore-result.json", parsed).status).toBe(
      "PASS",
    );
  });

  it("does not treat a PASS reason as BLOCKED", () => {
    const status = interpretEvidence("pitr-result.json", {
      result: "PASS",
      reason: "RPO measured",
    });
    expect(status.status).toBe("PASS");
  });

  it("maps campaign steps, queued soaks and emulator datasets", () => {
    expect(
      interpretEvidence("campaign-result.json", {
        steps: [
          { name: "hil-emulator", result: "PASS" },
          { name: "physical-hil-com7", result: "FAIL" },
        ],
      }).status,
    ).toBe("FAIL");
    expect(
      interpretEvidence("soak-multiday.json", {
        inProgress: false,
        queuedAfter: "soak-24h",
        soakMinutes: 4320,
      }).status,
    ).toBe("QUEUED");
    expect(
      interpretEvidence("dataset-manifest.json", {
        realNamedPlant: false,
        datasetId: "emulator",
      }).status,
    ).toBe("ENGINEERING");
    expect(
      interpretEvidence("pitr-result.json", {
        outcome: "PASS",
        measuredRpoSeconds: 4.69,
      }).status,
    ).toBe("PASS");
  });
});
