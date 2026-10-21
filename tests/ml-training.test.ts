import { describe, expect, it } from "vitest";
import {
  assertNoTimeLeakage,
  generatePilotPlantDataset,
  timeSplit,
  trainAnomalyModel,
  trainForecastModel,
} from "../packages/analytics/src/train.js";

describe("forecast and anomaly training", () => {
  it("uses a leakage-controlled time split and trains both models", () => {
    const dataset = generatePilotPlantDataset({
      days: 30,
      plants: ["pilot-plant-a", "pilot-plant-b"],
      intervalMinutes: 60,
      seed: 7,
    });
    expect(dataset.some((row) => row.inverterFault)).toBe(true);
    expect(dataset.some((row) => row.curtailedKw > 0)).toBe(true);
    expect(dataset.every((row) => row.operatorLabel)).toBeTruthy();
    const splits = timeSplit(dataset);
    expect(() => assertNoTimeLeakage(splits)).not.toThrow();
    const forecast = trainForecastModel(splits);
    const anomaly = trainAnomalyModel(splits);
    expect(forecast.evaluation.test.mae).toBeGreaterThanOrEqual(0);
    expect(forecast.evaluation.validation.rmse).toBeGreaterThanOrEqual(0);
    expect(anomaly.evaluation.test.f1).toBeGreaterThan(0);
    expect(anomaly.threshold).toBeGreaterThan(0);
  });

  it("fails when train and validation timestamps overlap", () => {
    const row = generatePilotPlantDataset({ days: 2, plants: ["pilot-plant-a"] })[0]!;
    expect(() =>
      assertNoTimeLeakage({
        train: [row],
        validation: [row],
        test: [{ ...row, timestamp: "2099-01-01T00:00:00.000Z" }],
      }),
    ).toThrow("LEAKAGE_TRAIN_VALIDATION_OVERLAP");
  });
});
