import { readFile } from "node:fs/promises";

interface DatasetManifest {
  datasetId: string;
  sourcePlantIds: string[];
  includes: {
    telemetry: boolean;
    inverterFaults: boolean;
    curtailmentEvents: boolean;
    weather: boolean;
    operatorLabels: boolean;
  };
  splits: {
    train: number;
    validation: number;
    test: number;
    splitStrategy: "time-based" | "plant-based" | "hybrid";
  };
  leakageControls: string[];
  approvedBy?: string;
}

const path = process.env.ZOLT_DATASET_MANIFEST ?? "docs/operations/dataset-manifest.json";
const text = await readFile(path, "utf8");
const manifest = JSON.parse(text) as DatasetManifest;

const failures: string[] = [];
if (!manifest.datasetId) failures.push("datasetId is required");
if ((manifest.sourcePlantIds ?? []).length < 1) failures.push("At least one plant is required");
if (!manifest.includes.telemetry) failures.push("Telemetry data is required");
if (!manifest.includes.inverterFaults) failures.push("Real faults are required");
if (!manifest.includes.curtailmentEvents) failures.push("Curtailment events are required");
if (!manifest.includes.weather) failures.push("Weather data is required");
if (!manifest.includes.operatorLabels) failures.push("Operator labels are required");
if (manifest.splits.splitStrategy !== "time-based") failures.push("Time-based split strategy is mandatory");
if ((manifest.splits.train ?? 0) < 0.6) failures.push("Train split must be at least 60%");
if ((manifest.splits.validation ?? 0) < 0.1) failures.push("Validation split must be at least 10%");
if ((manifest.splits.test ?? 0) < 0.1) failures.push("Test split must be at least 10%");
if (
  Math.abs((manifest.splits.train ?? 0) + (manifest.splits.validation ?? 0) + (manifest.splits.test ?? 0) - 1) >
  0.0001
) {
  failures.push("Split ratios must sum to 1.0");
}
if (!manifest.leakageControls || manifest.leakageControls.length < 3) {
  failures.push("At least three leakage-control statements are required");
}
if (!manifest.approvedBy) failures.push("Manifest must include approval sign-off");

if (failures.length > 0) {
  process.stderr.write(`Dataset readiness checks failed:\n- ${failures.join("\n- ")}\n`);
  process.exit(1);
}

process.stdout.write("Dataset readiness checks passed.\n");
