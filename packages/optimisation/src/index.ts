export interface DispatchPlan {
  chargeKw: number;
  dischargeKw: number;
  curtailedKw: number;
  flexibleLoadKw: number;
  hydrogenKg: number;
  objective: number;
  baselineCurtailmentKw: number;
  recoveredEnergyKwh: number;
  estimatedRevenueImpact: number;
  degradationCost: number;
  netRevenueImpact: number;
  constraintsSatisfied: boolean;
  advisoryOnly: true;
}

export interface BatteryEconomics {
  cycleCostPerMwh?: number;
  maxCRate?: number;
  reserveRequirementKwh?: number;
  roundTripEfficiency?: number;
  minTemperatureC?: number;
  maxTemperatureC?: number;
  batteryTemperatureC?: number;
  warrantyCycleLimit?: number;
  cyclesUsed?: number;
}

export function optimiseSite(input: {
  forecastKw: number;
  exportLimitKw: number;
  loadKw: number;
  batterySocPct: number;
  batteryPowerKw: number;
  hydrogenCapacityKgPerHour: number;
  tariff: number;
  batteryCapacityKwh?: number;
  reserveSocPct?: number;
  maximumSocPct?: number;
  flexibleLoadLimitKw?: number;
  carbonKgPerKwh?: number;
  economics?: BatteryEconomics;
}): DispatchPlan {
  const surplus = Math.max(0, input.forecastKw - input.loadKw);
  const deficit = Math.max(0, input.loadKw - input.forecastKw);
  const exportHeadroom = Math.max(
    0,
    input.exportLimitKw - Math.max(0, input.forecastKw - input.loadKw),
  );
  const reserveSocPct = input.reserveSocPct ?? 15;
  const maximumSocPct = input.maximumSocPct ?? 90;
  const economics = input.economics ?? {};
  const temperatureBlocked =
    (economics.minTemperatureC !== undefined &&
      economics.batteryTemperatureC !== undefined &&
      economics.batteryTemperatureC < economics.minTemperatureC) ||
    (economics.maxTemperatureC !== undefined &&
      economics.batteryTemperatureC !== undefined &&
      economics.batteryTemperatureC > economics.maxTemperatureC);
  const warrantyExhausted =
    economics.warrantyCycleLimit !== undefined &&
    economics.cyclesUsed !== undefined &&
    economics.cyclesUsed >= economics.warrantyCycleLimit;
  const cRateKw =
    economics.maxCRate && input.batteryCapacityKwh
      ? economics.maxCRate * input.batteryCapacityKwh
      : input.batteryPowerKw;
  const reservedKw =
    economics.reserveRequirementKwh ?? 0;
  const capacityLimitedCharge =
    temperatureBlocked || warrantyExhausted
      ? 0
      : input.batteryCapacityKwh === undefined
        ? Math.min(input.batteryPowerKw, cRateKw)
        : Math.max(
            0,
            (input.batteryCapacityKwh * (maximumSocPct - input.batterySocPct)) /
              100,
          );
  const capacityLimitedDischarge =
    temperatureBlocked || warrantyExhausted
      ? 0
      : input.batteryCapacityKwh === undefined
        ? Math.min(input.batteryPowerKw, cRateKw)
        : Math.max(
            0,
            (input.batteryCapacityKwh * (input.batterySocPct - reserveSocPct)) /
              100 -
              reservedKw,
          );
  const roundTrip = Math.min(
    1,
    Math.max(0.5, economics.roundTripEfficiency ?? 0.92),
  );
  const chargeKw =
    input.batterySocPct < maximumSocPct
      ? Math.min(
          input.batteryPowerKw,
          cRateKw,
          capacityLimitedCharge,
          surplus,
          exportHeadroom || surplus,
        )
      : 0;
  const dischargeKw =
    input.batterySocPct > reserveSocPct
      ? Math.min(
          input.batteryPowerKw,
          cRateKw,
          capacityLimitedDischarge * roundTrip,
          deficit,
        )
      : 0;
  const afterStorage = surplus - chargeKw + dischargeKw;
  const curtailedKw = Math.max(0, afterStorage - input.exportLimitKw);
  const flexibleLoadKw = Math.min(
    curtailedKw,
    input.flexibleLoadLimitKw ?? Math.max(0, input.loadKw * 0.2),
  );
  const remainingCurtailment = Math.max(0, curtailedKw - flexibleLoadKw);
  const hydrogenKg = Math.min(
    input.hydrogenCapacityKgPerHour,
    remainingCurtailment / 50,
  );
  const carbonValue =
    (chargeKw + flexibleLoadKw) * (input.carbonKgPerKwh ?? 0) * 0.1;
  const throughputMwh = (chargeKw + dischargeKw) / 1000;
  const degradationCost = throughputMwh * (economics.cycleCostPerMwh ?? 0);
  const baselineCurtailmentKw = Math.max(0, surplus - input.exportLimitKw);
  const recoveredEnergyKwh = Math.max(
    0,
    baselineCurtailmentKw - remainingCurtailment,
  );
  const estimatedRevenueImpact = recoveredEnergyKwh * input.tariff;
  const objective =
    -(chargeKw * 0.1) +
    dischargeKw * input.tariff +
    -curtailedKw * input.tariff +
    flexibleLoadKw * input.tariff * 0.5 +
    hydrogenKg * 20 +
    carbonValue -
    degradationCost;
  return {
    chargeKw: Number(chargeKw.toFixed(3)),
    dischargeKw: Number(dischargeKw.toFixed(3)),
    curtailedKw: Number(remainingCurtailment.toFixed(3)),
    flexibleLoadKw: Number(flexibleLoadKw.toFixed(3)),
    hydrogenKg: Number(hydrogenKg.toFixed(3)),
    objective: Number(objective.toFixed(3)),
    baselineCurtailmentKw: Number(baselineCurtailmentKw.toFixed(3)),
    recoveredEnergyKwh: Number(recoveredEnergyKwh.toFixed(3)),
    estimatedRevenueImpact: Number(estimatedRevenueImpact.toFixed(2)),
    degradationCost: Number(degradationCost.toFixed(4)),
    netRevenueImpact: Number((estimatedRevenueImpact - degradationCost).toFixed(2)),
    constraintsSatisfied:
      input.batterySocPct >= 0 &&
      input.batterySocPct <= 100 &&
      reserveSocPct < maximumSocPct &&
      !temperatureBlocked &&
      !warrantyExhausted,
    advisoryOnly: true,
  };
}

export type StrategyName =
  | "no-action"
  | "simple-rules"
  | "greedy"
  | "zolt"
  | "offline-optimum";

export type StrategyInput = Parameters<typeof optimiseSite>[0];

export function noActionPlan(input: StrategyInput): DispatchPlan {
  const surplus = Math.max(0, input.forecastKw - input.loadKw);
  const curtailedKw = Math.max(0, surplus - input.exportLimitKw);
  return {
    chargeKw: 0,
    dischargeKw: 0,
    curtailedKw: Number(curtailedKw.toFixed(3)),
    flexibleLoadKw: 0,
    hydrogenKg: 0,
    objective: Number((-curtailedKw * input.tariff).toFixed(3)),
    baselineCurtailmentKw: Number(curtailedKw.toFixed(3)),
    recoveredEnergyKwh: 0,
    estimatedRevenueImpact: 0,
    degradationCost: 0,
    netRevenueImpact: 0,
    constraintsSatisfied: true,
    advisoryOnly: true,
  };
}

export function simpleRulesPlan(input: StrategyInput): DispatchPlan {
  const surplus = Math.max(0, input.forecastKw - input.loadKw);
  const deficit = Math.max(0, input.loadKw - input.forecastKw);
  const chargeKw =
    surplus > 0 && input.batterySocPct < 80
      ? Math.min(input.batteryPowerKw, surplus)
      : 0;
  const dischargeKw =
    deficit > 0 && input.batterySocPct > 20
      ? Math.min(input.batteryPowerKw, deficit)
      : 0;
  const afterStorage = surplus - chargeKw + dischargeKw;
  const curtailedKw = Math.max(0, afterStorage - input.exportLimitKw);
  return {
    chargeKw,
    dischargeKw,
    curtailedKw,
    flexibleLoadKw: 0,
    hydrogenKg: 0,
    objective: Number((dischargeKw * input.tariff - curtailedKw * input.tariff).toFixed(3)),
    baselineCurtailmentKw: Number(Math.max(0, surplus - input.exportLimitKw).toFixed(3)),
    recoveredEnergyKwh: Number(
      Math.max(0, Math.max(0, surplus - input.exportLimitKw) - curtailedKw).toFixed(3),
    ),
    estimatedRevenueImpact: 0,
    degradationCost: 0,
    netRevenueImpact: 0,
    constraintsSatisfied: true,
    advisoryOnly: true,
  };
}

export function greedyPlan(input: StrategyInput): DispatchPlan {
  return simpleRulesPlan(input);
}

export function offlineOptimumPlan(input: StrategyInput): DispatchPlan {
  let best = optimiseSite(input);
  for (const chargeKw of [0, input.batteryPowerKw / 2, input.batteryPowerKw]) {
    for (const dischargeKw of [0, input.batteryPowerKw / 2, input.batteryPowerKw]) {
      if (chargeKw > 0 && dischargeKw > 0) continue;
      const candidate = optimiseSite({
        ...input,
        batteryPowerKw: Math.max(chargeKw, dischargeKw, 0.001),
      });
      if (candidate.objective > best.objective) best = candidate;
    }
  }
  return best;
}

export function benchmarkStrategies(
  input: StrategyInput,
): Record<StrategyName, DispatchPlan> {
  return {
    "no-action": noActionPlan(input),
    "simple-rules": simpleRulesPlan(input),
    greedy: greedyPlan(input),
    zolt: optimiseSite(input),
    "offline-optimum": offlineOptimumPlan(input),
  };
}

export * from "./horizon.js";
