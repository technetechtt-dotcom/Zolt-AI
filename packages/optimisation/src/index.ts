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
      ? Math.min(input.batteryPowerKw, cRateKw, capacityLimitedDischarge, deficit)
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

export * from "./horizon.js";
