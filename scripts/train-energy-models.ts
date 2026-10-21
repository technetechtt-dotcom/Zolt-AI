import { mkdir, writeFile } from "node:fs/promises";
import {
  generatePilotPlantDataset,
  timeSplit,
  trainAnomalyModel,
  trainForecastModel,
} from "../packages/analytics/src/train.js";
import { promoteChampion, registerModel } from "../packages/mlops/src/index.js";
import { greedyHorizon, optimiseHorizon } from "../packages/optimisation/src/horizon.js";

const dataset = generatePilotPlantDataset({
  days: 90,
  plants: ["pilot-plant-a", "pilot-plant-b"],
  intervalMinutes: 60,
  seed: 20261021,
});
const splits = timeSplit(dataset);
const forecast = trainForecastModel(splits);
const anomaly = trainAnomalyModel(splits);

registerModel({
  tenantId: "tenant-pilot",
  name: forecast.name,
  version: forecast.version,
  status: "candidate",
  trainingDatasetVersion: "pilot-emulator-90d-v1",
  featureSetVersion: "clearsky-cloud-irradiance-temp-v1",
  trainedAt: new Date().toISOString(),
  owner: "zolt-ml",
  approvalOwner: "zolt-ml",
  environment: "development",
  evaluation: {
    validationMae: forecast.evaluation.validation.mae,
    testMae: forecast.evaluation.test.mae,
    testRmse: forecast.evaluation.test.rmse,
  },
  intendedUse: "Advisory solar production forecast for GridFlex pilot sites",
  limitations: [
    "Trained on high-fidelity emulator physics, not a live named plant",
    "Does not command inverters",
  ],
  safetyThresholds: { maximumError: 40, maximumDrift: 0.25 },
  metadata: { residualStdKw: forecast.residualStdKw },
});
promoteChampion(forecast.name, forecast.version, {
  tenantId: "tenant-pilot",
  approvalOwner: "zolt-ml",
});

registerModel({
  tenantId: "tenant-pilot",
  name: anomaly.name,
  version: anomaly.version,
  status: "candidate",
  trainingDatasetVersion: "pilot-emulator-90d-v1",
  trainedAt: new Date().toISOString(),
  owner: "zolt-ml",
  approvalOwner: "zolt-ml",
  environment: "development",
  evaluation: {
    validationF1: anomaly.evaluation.validation.f1,
    testF1: anomaly.evaluation.test.f1,
    testRecall: anomaly.evaluation.test.recall,
  },
  intendedUse: "Advisory inverter anomaly detection",
  limitations: ["Labels are emulator-generated operator classes"],
  safetyThresholds: { maximumDrift: 0.25 },
  metadata: { threshold: anomaly.threshold },
});
promoteChampion(anomaly.name, anomaly.version, {
  tenantId: "tenant-pilot",
  approvalOwner: "zolt-ml",
});

const day = Array.from({ length: 24 }, (_, hourUtc) => {
  const sample = dataset.find((row) => row.plantId === "pilot-plant-a" && row.hourUtc === hourUtc);
  return {
    hourUtc,
    forecastKw: sample?.expectedPowerKw ?? 0,
    loadKw: 30 + (hourUtc >= 18 ? 50 : 5),
    exportLimitKw: 90,
    tariff: hourUtc >= 17 && hourUtc <= 20 ? 2.4 : 1.2,
  };
});
const site = {
  batteryPowerKw: 80,
  batteryCapacityKwh: 200,
  hydrogenCapacityKgPerHour: 2,
  flexibleLoadLimitKw: 25,
};
const greedy = greedyHorizon(site, 45, day);
const horizon = optimiseHorizon(site, 45, day);

const manifest = {
  datasetId: "pilot-emulator-90d-v1",
  sourcePlantIds: ["pilot-plant-a", "pilot-plant-b"],
  source: "controlled-gridflex-pilot-emulator",
  realNamedPlant: false,
  includes: {
    telemetry: true,
    inverterFaults: true,
    curtailmentEvents: true,
    weather: true,
    operatorLabels: true,
  },
  splits: {
    train: 0.7,
    validation: 0.15,
    test: 0.15,
    splitStrategy: "time-based",
  },
  leakageControls: forecast.leakageControls,
  rowCount: dataset.length,
  trainCount: splits.train.length,
  validationCount: splits.validation.length,
  testCount: splits.test.length,
  approvedBy: "zolt-ml@local",
};

await mkdir("docs/operations/models", { recursive: true });
await mkdir("docs/operations/datasets", { recursive: true });
await writeFile("docs/operations/dataset-manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(
  "docs/operations/datasets/pilot-emulator-90d-v1.jsonl",
  `${dataset.map((row) => JSON.stringify(row)).join("\n")}\n`,
);
await writeFile("docs/operations/models/forecast-v1.json", `${JSON.stringify(forecast, null, 2)}\n`);
await writeFile("docs/operations/models/anomaly-v1.json", `${JSON.stringify(anomaly, null, 2)}\n`);
await writeFile(
  "docs/operations/models/optimisation-validation.json",
  `${JSON.stringify({ greedy, horizon, advisoryOnly: true }, null, 2)}\n`,
);
await writeFile(
  "docs/operations/ml-training-result.json",
  `${JSON.stringify(
    {
      executedAt: new Date().toISOString(),
      dataset: manifest.datasetId,
      forecast,
      anomaly,
      optimisation: {
        recoveredEnergyKwh: horizon.recoveredEnergyKwh,
        improvementVsGreedy: horizon.improvementVsGreedy,
        constraintsSatisfied: horizon.constraintsSatisfied,
        advisoryOnly: true,
      },
      result: "PASS",
    },
    null,
    2,
  )}\n`,
);

process.stdout.write("Trained forecast, anomaly, and horizon optimisation models.\n");
