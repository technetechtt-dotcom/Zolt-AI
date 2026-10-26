import { describe, expect, it } from "vitest";
import {
  detectAutomatedDrift,
  evaluateChallenger,
  registerModel,
} from "../packages/mlops/src/index.js";

describe("model governance", () => {
  it("promotes a challenger only when it beats the champion metric", () => {
    registerModel({
      name: "forecast",
      version: "1.0.0",
      status: "champion",
      evaluation: { mae: 12 },
      approvalOwner: "ml",
      metadata: {},
    });
    registerModel({
      name: "forecast",
      version: "1.1.0",
      status: "challenger",
      evaluation: { mae: 9 },
      metadata: {},
    });
    const decision = evaluateChallenger({
      name: "forecast",
      championVersion: "1.0.0",
      challengerVersion: "1.1.0",
    });
    expect(decision.promote).toBe(true);
  });

  it("disables a champion when automated drift is critical", () => {
    registerModel({
      name: "anomaly",
      version: "2.0.0",
      status: "champion",
      evaluation: { f1: 0.8 },
      approvalOwner: "ml",
      safetyThresholds: { maximumDrift: 0.2 },
      metadata: {},
    });
    const card = detectAutomatedDrift({
      name: "anomaly",
      version: "2.0.0",
      featureDrift: { powerKw: 0.4 },
      forecastBias: 0.1,
      anomalyRate: 0.3,
      baselineAnomalyRate: 0.05,
    });
    expect(card.driftStatus).toBe("critical");
    expect(card.status).toBe("disabled");
  });
});
