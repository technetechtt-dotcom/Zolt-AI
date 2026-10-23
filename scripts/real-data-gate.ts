import { mkdir, writeFile } from "node:fs/promises";

const plant = process.env.ZOLT_REAL_PLANT_ID?.trim();
const dataset = process.env.ZOLT_REAL_DATASET_PATH?.trim();
const scores = {
  solarForecastMae: Number(process.env.ZOLT_REAL_FORECAST_MAE ?? "NaN"),
  curtailmentAuc: Number(process.env.ZOLT_REAL_CURTAILMENT_AUC ?? "NaN"),
  anomalyRecall: Number(process.env.ZOLT_REAL_ANOMALY_RECALL ?? "NaN"),
  commsFailureRecall: Number(process.env.ZOLT_REAL_COMMS_RECALL ?? "NaN"),
};

const hasNamedPlant = Boolean(plant && dataset);
const numeric = Object.values(scores).every((value) => Number.isFinite(value));
const pass =
  hasNamedPlant &&
  numeric &&
  scores.solarForecastMae <= 0.15 &&
  scores.curtailmentAuc >= 0.8 &&
  scores.anomalyRecall >= 0.7 &&
  scores.commsFailureRecall >= 0.8;

const report = {
  executedAt: new Date().toISOString(),
  failClosed: true,
  namedPlant: plant || null,
  dataset: dataset || null,
  scores,
  result: pass ? "PASS" : "FAIL",
  reason: pass
    ? "Real-data benchmark met fail-closed gates"
    : hasNamedPlant
      ? "Named plant dataset present but scores missed the gate"
      : "No named-plant dataset. Emulator scores are not accepted.",
};

await mkdir("docs/operations", { recursive: true });
await writeFile(
  "docs/operations/real-data-gate.json",
  `${JSON.stringify(report, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!pass) process.exitCode = 1;
