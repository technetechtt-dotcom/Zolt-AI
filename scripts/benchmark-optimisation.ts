import { mkdir, writeFile } from "node:fs/promises";
import {
  greedyHorizon,
  optimiseHorizon,
  type HorizonSite,
  type HorizonStepInput,
} from "../packages/optimisation/src/horizon.js";
import { optimiseSite } from "../packages/optimisation/src/index.js";

function day(
  weather: "clear" | "cloudy" | "storm",
  exportLimitKw: number,
  batteryKwh: number,
  tariffPeak: number,
): { site: HorizonSite; horizon: HorizonStepInput[]; noActionRecovered: number } {
  const site: HorizonSite = {
    batteryPowerKw: Math.min(60, batteryKwh / 2),
    batteryCapacityKwh: batteryKwh,
    hydrogenCapacityKgPerHour: weather === "storm" ? 0 : 1,
    flexibleLoadLimitKw: 12,
    economics: { cycleCostPerMwh: 80, maxCRate: 0.8, roundTripEfficiency: 0.9 },
  };
  const horizon = Array.from({ length: 24 }, (_, hourUtc) => {
    const solar =
      weather === "clear"
        ? hourUtc >= 7 && hourUtc <= 16
          ? 150
          : 6
        : weather === "cloudy"
          ? hourUtc >= 8 && hourUtc <= 15
            ? 70
            : 5
          : hourUtc >= 9 && hourUtc <= 13
            ? 30
            : 4;
    return {
      hourUtc,
      forecastKw: solar,
      loadKw: hourUtc >= 17 ? 85 : 32,
      exportLimitKw,
      tariff: hourUtc >= 18 && hourUtc <= 21 ? tariffPeak : 1,
    };
  });
  const noActionRecovered = horizon.reduce((sum, step) => {
    const surplus = Math.max(0, step.forecastKw - step.loadKw);
    return sum + Math.max(0, surplus - step.exportLimitKw);
  }, 0);
  return { site, horizon, noActionRecovered };
}

const scenarios = [
  day("clear", 90, 120, 2.4),
  day("cloudy", 60, 80, 1.8),
  day("storm", 40, 40, 3.1),
  day("clear", 50, 200, 2.1),
];

const rows = scenarios.map((scenario, index) => {
  const none = {
    recoveredEnergyKwh: 0,
    estimatedRevenueImpact: 0,
    curtailmentKwh: scenario.noActionRecovered,
  };
  const rule = greedyHorizon(scenario.site, 40, scenario.horizon);
  const zolt = optimiseHorizon(scenario.site, 40, scenario.horizon);
  const sample = optimiseSite({
    forecastKw: 180,
    exportLimitKw: 80,
    loadKw: 40,
    batterySocPct: 45,
    batteryPowerKw: scenario.site.batteryPowerKw,
    hydrogenCapacityKgPerHour: scenario.site.hydrogenCapacityKgPerHour,
    tariff: 2,
    batteryCapacityKwh: scenario.site.batteryCapacityKwh,
    economics: scenario.site.economics,
  });
  return {
    scenario: index + 1,
    noAction: none,
    greedy: {
      recoveredEnergyKwh: rule.recoveredEnergyKwh,
      estimatedRevenueImpact: rule.estimatedRevenueImpact,
    },
    zolt: {
      recoveredEnergyKwh: zolt.recoveredEnergyKwh,
      estimatedRevenueImpact: zolt.estimatedRevenueImpact,
      improvementVsGreedy: zolt.improvementVsGreedy,
      netRevenueImpact: sample.netRevenueImpact,
      degradationCost: sample.degradationCost,
    },
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  advisoryOnly: true,
  comparedWith: ["no-action", "greedy", "zolt"],
  offlineOptimum: "not computed — requires MILP solver; greedy/arbitrage used as reference",
  scenarios: rows,
};
await mkdir("docs/operations/models", { recursive: true });
await writeFile(
  "docs/operations/models/optimisation-validation.json",
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
