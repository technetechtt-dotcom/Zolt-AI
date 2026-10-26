import { optimiseSite, type BatteryEconomics, type DispatchPlan } from "./index.js";

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
  economics?: BatteryEconomics;
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
  const rounding = 0.05;
  if (plan.chargeKw > site.batteryPowerKw + rounding) violations.push("charge-power");
  if (plan.dischargeKw > site.batteryPowerKw + rounding) violations.push("discharge-power");
  if (plan.hydrogenKg > site.hydrogenCapacityKgPerHour * durationHours + rounding) {
    violations.push("hydrogen-rate");
  }
  if (next < reserve - rounding) violations.push("reserve-soc");
  if (next > maximum + rounding) violations.push("maximum-soc");
  if (plan.chargeKw > 0 && plan.dischargeKw > 0) violations.push("simultaneous-charge-discharge");
  return {
    socPct: Number(Math.min(maximum, Math.max(reserve, next)).toFixed(4)),
    violations,
  };
}

function sitePlan(
  site: HorizonSite,
  input: HorizonStepInput,
  socPct: number,
  reserveSocPct?: number,
  maximumSocPct?: number,
): DispatchPlan {
  const reserve = site.reserveSocPct ?? 15;
  const maximum = site.maximumSocPct ?? 90;
  return optimiseSite({
    forecastKw: input.forecastKw,
    exportLimitKw: input.exportLimitKw,
    loadKw: input.loadKw,
    batterySocPct: socPct,
    batteryPowerKw: site.batteryPowerKw,
    hydrogenCapacityKgPerHour: site.hydrogenCapacityKgPerHour,
    tariff: input.tariff,
    batteryCapacityKwh: site.batteryCapacityKwh,
    reserveSocPct: Math.min(maximum - 1, Math.max(reserve, reserveSocPct ?? reserve)),
    maximumSocPct: Math.max(reserve + 1, maximumSocPct ?? maximum),
    flexibleLoadLimitKw: site.flexibleLoadLimitKw,
    carbonKgPerKwh: input.carbonKgPerKwh,
    economics: site.economics,
  });
}

export function greedyHorizon(
  site: HorizonSite,
  initialSocPct: number,
  horizon: HorizonStepInput[],
): HorizonPlan {
  return runHorizon(site, initialSocPct, horizon, (input, socPct) =>
    sitePlan(site, input, socPct),
  );
}

export function arbitrageHorizon(
  site: HorizonSite,
  initialSocPct: number,
  horizon: HorizonStepInput[],
): HorizonPlan {
  const peakTariff = horizon.reduce((max, step) => Math.max(max, step.tariff), 0);
  return runHorizon(site, initialSocPct, horizon, (input, socPct, index) => {
    const laterPeak = horizon
      .slice(index + 1)
      .some((step) => step.tariff > input.tariff + 0.2);
    if (laterPeak && input.tariff < peakTariff - 0.05) {
      return sitePlan(site, input, socPct, socPct);
    }
    return sitePlan(site, input, socPct);
  });
}

export function optimiseHorizon(
  site: HorizonSite,
  initialSocPct: number,
  horizon: HorizonStepInput[],
): HorizonPlan {
  const greedy = greedyHorizon(site, initialSocPct, horizon);
  const arbitrage = arbitrageHorizon(site, initialSocPct, horizon);
  const selected = objective(arbitrage) >= objective(greedy) ? arbitrage : greedy;
  return {
    ...selected,
    improvementVsGreedy: Number((objective(selected) - objective(greedy)).toFixed(4)),
  };
}

function objective(plan: HorizonPlan): number {
  return plan.recoveredEnergyKwh + plan.estimatedRevenueImpact * 0.25;
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
    let plan = decide(input, socPct, index);
    let simulated = simulateDispatch(site, socPct, plan);
    if (simulated.violations.length > 0 || !plan.constraintsSatisfied) {
      plan = sitePlan(site, input, socPct);
      simulated = simulateDispatch(site, socPct, plan);
    }
    if (simulated.violations.length > 0 || !plan.constraintsSatisfied) {
      constraintsSatisfied = false;
    }
    baselineCurtailmentKwh += plan.baselineCurtailmentKw;
    recoveredEnergyKwh += plan.recoveredEnergyKwh;
    estimatedRevenueImpact +=
      plan.estimatedRevenueImpact + (plan.dischargeKw - plan.chargeKw) * input.tariff;
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
