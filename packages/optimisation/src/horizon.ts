import { optimiseSite, type DispatchPlan } from "./index.js";

export interface HorizonStepInput {
  hourUtc: number;
  forecastKw: number;
  loadKw: number;
  exportLimitKw: number;
  tariff: number;
  carbonKgPerKwh?: number;
}

export interface HorizonSite {
  batteryPowerKw: number;
  batteryCapacityKwh: number;
  hydrogenCapacityKgPerHour: number;
  reserveSocPct?: number;
  maximumSocPct?: number;
  flexibleLoadLimitKw?: number;
  roundTripEfficiency?: number;
}

export interface HorizonStepResult {
  hourUtc: number;
  socPct: number;
  plan: DispatchPlan;
  simulatedSocPct: number;
  constraintViolations: string[];
}

export interface HorizonPlan {
  advisoryOnly: true;
  baselineCurtailmentKwh: number;
  recoveredEnergyKwh: number;
  estimatedRevenueImpact: number;
  constraintsSatisfied: boolean;
  improvementVsGreedy: number;
  steps: HorizonStepResult[];
}

export function simulateDispatch(
  site: HorizonSite,
  socPct: number,
  plan: DispatchPlan,
  durationHours = 1,
): { socPct: number; violations: string[] } {
  const reserve = site.reserveSocPct ?? 15;
  const maximum = site.maximumSocPct ?? 90;
  const efficiency = site.roundTripEfficiency ?? 1;
  const chargeEnergy = plan.chargeKw * durationHours * Math.sqrt(efficiency);
  const dischargeEnergy = plan.dischargeKw * durationHours / Math.sqrt(efficiency);
  const next =
    socPct +
    ((chargeEnergy - dischargeEnergy) / Math.max(site.batteryCapacityKwh, 1)) * 100;
  const violations: string[] = [];
  if (plan.chargeKw > site.batteryPowerKw + 1e-6) violations.push("charge-power");
  if (plan.dischargeKw > site.batteryPowerKw + 1e-6) violations.push("discharge-power");
  if (plan.hydrogenKg > site.hydrogenCapacityKgPerHour * durationHours + 1e-6) {
    violations.push("hydrogen-rate");
  }
  if (next < reserve - 1e-6) violations.push("reserve-soc");
  if (next > maximum + 1e-6) violations.push("maximum-soc");
  if (plan.chargeKw > 0 && plan.dischargeKw > 0) violations.push("simultaneous-charge-discharge");
  return {
    socPct: Number(Math.min(maximum, Math.max(reserve, next)).toFixed(4)),
    violations,
  };
}

export function greedyHorizon(
  site: HorizonSite,
  initialSocPct: number,
  horizon: HorizonStepInput[],
): HorizonPlan {
  return runHorizon(site, initialSocPct, horizon, (input, socPct) =>
    optimiseSite({
      forecastKw: input.forecastKw,
      exportLimitKw: input.exportLimitKw,
      loadKw: input.loadKw,
      batterySocPct: socPct,
      batteryPowerKw: site.batteryPowerKw,
      hydrogenCapacityKgPerHour: site.hydrogenCapacityKgPerHour,
      tariff: input.tariff,
      batteryCapacityKwh: site.batteryCapacityKwh,
      reserveSocPct: site.reserveSocPct,
      maximumSocPct: site.maximumSocPct,
      flexibleLoadLimitKw: site.flexibleLoadLimitKw,
      carbonKgPerKwh: input.carbonKgPerKwh,
    }),
  );
}

export function optimiseHorizon(
  site: HorizonSite,
  initialSocPct: number,
  horizon: HorizonStepInput[],
): HorizonPlan {
  const greedy = greedyHorizon(site, initialSocPct, horizon);
  const lookahead = runHorizon(site, initialSocPct, horizon, (input, socPct, index) => {
    const remaining = horizon.slice(index);
    const futureDeficit = remaining.reduce(
      (sum, step) => sum + Math.max(0, step.loadKw - step.forecastKw),
      0,
    );
    const futureSurplus = remaining.reduce(
      (sum, step) => sum + Math.max(0, step.forecastKw - step.loadKw - step.exportLimitKw),
      0,
    );
    const reserve = site.reserveSocPct ?? 15;
    const maximum = site.maximumSocPct ?? 90;
    const holdForEvening = futureDeficit > futureSurplus;
    return optimiseSite({
      forecastKw: input.forecastKw,
      exportLimitKw: input.exportLimitKw,
      loadKw: input.loadKw,
      batterySocPct: socPct,
      batteryPowerKw: site.batteryPowerKw,
      hydrogenCapacityKgPerHour: site.hydrogenCapacityKgPerHour,
      tariff: input.tariff,
      batteryCapacityKwh: site.batteryCapacityKwh,
      reserveSocPct: holdForEvening ? Math.min(maximum - 1, reserve + 12) : reserve,
      maximumSocPct: holdForEvening ? maximum : Math.max(reserve + 1, maximum - 8),
      flexibleLoadLimitKw: site.flexibleLoadLimitKw,
      carbonKgPerKwh: input.carbonKgPerKwh,
    });
  });
  const improvementVsGreedy =
    lookahead.recoveredEnergyKwh - greedy.recoveredEnergyKwh +
    (lookahead.estimatedRevenueImpact - greedy.estimatedRevenueImpact) * 0.01;
  const selected = improvementVsGreedy >= 0 ? lookahead : greedy;
  return {
    ...selected,
    improvementVsGreedy: Number(improvementVsGreedy.toFixed(4)),
  };
}

function runHorizon(
  site: HorizonSite,
  initialSocPct: number,
  horizon: HorizonStepInput[],
  decide: (input: HorizonStepInput, socPct: number, index: number) => DispatchPlan,
): HorizonPlan {
  let socPct = initialSocPct;
  const steps: HorizonStepResult[] = [];
  let baselineCurtailmentKwh = 0;
  let recoveredEnergyKwh = 0;
  let estimatedRevenueImpact = 0;
  let constraintsSatisfied = true;
  for (const [index, input] of horizon.entries()) {
    const plan = decide(input, socPct, index);
    const simulated = simulateDispatch(site, socPct, plan);
    if (simulated.violations.length > 0 || !plan.constraintsSatisfied) {
      constraintsSatisfied = false;
    }
    baselineCurtailmentKwh += plan.baselineCurtailmentKw;
    recoveredEnergyKwh += plan.recoveredEnergyKwh;
    estimatedRevenueImpact += plan.estimatedRevenueImpact;
    steps.push({
      hourUtc: input.hourUtc,
      socPct,
      plan,
      simulatedSocPct: simulated.socPct,
      constraintViolations: simulated.violations,
    });
    socPct = simulated.socPct;
  }
  return {
    advisoryOnly: true,
    baselineCurtailmentKwh: Number(baselineCurtailmentKwh.toFixed(3)),
    recoveredEnergyKwh: Number(recoveredEnergyKwh.toFixed(3)),
    estimatedRevenueImpact: Number(estimatedRevenueImpact.toFixed(2)),
    constraintsSatisfied,
    improvementVsGreedy: 0,
    steps,
  };
}
