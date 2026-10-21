import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  predictForecastKw,
  scoreAnomaly,
  type PlantObservation,
  type TrainedAnomalyModel,
  type TrainedForecastModel,
} from "../packages/analytics/src/train.js";
import { forecastMetrics } from "../packages/analytics/src/index.js";
import { optimiseHorizon } from "../packages/optimisation/src/horizon.js";

const datasetPath =
  process.env.ZOLT_LIVE_DATASET ?? "docs/operations/datasets/live-gridflex.jsonl";
const forecastPath = "docs/operations/models/forecast-v1.json";
const anomalyPath = "docs/operations/models/anomaly-v1.json";

async function loadJsonl(path: string): Promise<PlantObservation[]> {
  const text = await readFile(path, "utf8");
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as PlantObservation);
}

const requireReal = process.env.ZOLT_REQUIRE_REAL_PLANT !== "false";
let rows: PlantObservation[] = [];
let source = datasetPath;
try {
  rows = await loadJsonl(datasetPath);
} catch {
  source = "docs/operations/datasets/pilot-emulator-90d-v1.jsonl";
  rows = await loadJsonl(source);
}

const realNamedPlant = rows.some((row) => row.plantId && !row.plantId.startsWith("pilot-"));
if (requireReal && !realNamedPlant) {
  const report = {
    executedAt: new Date().toISOString(),
    result: "FAIL",
    reason: "REAL_GRIDFLEX_DATASET_UNAVAILABLE",
    source,
    rowCount: rows.length,
    realNamedPlant: false,
  };
  await mkdir("docs/operations", { recursive: true });
  await writeFile(
    "docs/operations/model-benchmark.json",
    `${JSON.stringify(report, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 1;
} else {
  const forecast = JSON.parse(await readFile(forecastPath, "utf8")) as TrainedForecastModel;
  const anomaly = JSON.parse(await readFile(anomalyPath, "utf8")) as TrainedAnomalyModel;
  const predicted = rows.map((row) => predictForecastKw(forecast, row));
  const metrics = forecastMetrics(
    rows.map((row) => row.powerKw),
    predicted,
  );
  const labels = rows.map((row) => row.operatorLabel === "fault" || row.operatorLabel === "anomaly");
  const detections = rows.map((row) => scoreAnomaly(anomaly, row).anomaly);
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const [index, actual] of labels.entries()) {
    if (detections[index] && actual) tp += 1;
    else if (detections[index] && !actual) fp += 1;
    else if (!detections[index] && actual) fn += 1;
  }
  const precision = tp / Math.max(tp + fp, 1);
  const recall = tp / Math.max(tp + fn, 1);
  const day = Array.from({ length: 24 }, (_, hourUtc) => {
    const sample = rows.find((row) => row.hourUtc === hourUtc);
    return {
      hourUtc,
      forecastKw: sample?.expectedPowerKw ?? 0,
      loadKw: 35,
      exportLimitKw: sample?.exportLimitKw ?? 90,
      tariff: 1.2,
    };
  });
  const horizon = optimiseHorizon(
    {
      batteryPowerKw: 80,
      batteryCapacityKwh: 200,
      hydrogenCapacityKgPerHour: 2,
    },
    45,
    day,
  );
  const report = {
    executedAt: new Date().toISOString(),
    result: "PASS",
    source,
    realNamedPlant,
    rowCount: rows.length,
    forecast: metrics,
    anomaly: {
      precision: Number(precision.toFixed(4)),
      recall: Number(recall.toFixed(4)),
      f1: Number(((2 * precision * recall) / Math.max(precision + recall, 1e-9)).toFixed(4)),
    },
    optimisation: {
      recoveredEnergyKwh: horizon.recoveredEnergyKwh,
      constraintsSatisfied: horizon.constraintsSatisfied,
      advisoryOnly: true,
    },
  };
  await mkdir("docs/operations", { recursive: true });
  await writeFile(
    "docs/operations/model-benchmark.json",
    `${JSON.stringify(report, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
