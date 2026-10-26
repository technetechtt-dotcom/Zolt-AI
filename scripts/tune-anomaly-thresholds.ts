import { mkdir, writeFile } from "node:fs/promises";
import { tuneAnomalyThreshold } from "../packages/analytics/src/anomaly-cost.js";

const emulator = [
  { score: 0.12, anomalous: false, category: "voltage" },
  { score: 0.18, anomalous: false, category: "voltage" },
  { score: 0.41, anomalous: false, category: "comms" },
  { score: 0.55, anomalous: true, category: "inverter", leadTimeMinutes: 8 },
  { score: 0.62, anomalous: true, category: "inverter", leadTimeMinutes: 14 },
  { score: 0.71, anomalous: true, category: "temperature", leadTimeMinutes: 20 },
  { score: 0.33, anomalous: true, category: "comms", leadTimeMinutes: 4 },
  { score: 0.22, anomalous: false, category: "temperature" },
];

const tuned = tuneAnomalyThreshold(emulator, {
  falseAlarmCost: 1,
  missCost: 6,
});
const report = {
  generatedAt: new Date().toISOString(),
  dataset: "emulator-synthetic",
  realNamedPlant: false,
  selected: tuned.selected,
  byCategory: tuned.byCategory,
  note: "Emulator tuning is engineering evidence only. Production qualification stays fail-closed until a named plant dataset exists.",
};
await mkdir("docs/operations/models", { recursive: true });
await writeFile(
  "docs/operations/models/anomaly-cost-tuning.json",
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
