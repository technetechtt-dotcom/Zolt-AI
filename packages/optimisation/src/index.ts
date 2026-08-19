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
  constraintsSatisfied: boolean;
  advisoryOnly: true;
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
}): DispatchPlan {
  const surplus = Math.max(0, input.forecastKw - input.loadKw);
  const deficit = Math.max(0, input.loadKw - input.forecastKw);
  const exportHeadroom = Math.max(
    0,
    input.exportLimitKw - Math.max(0, input.forecastKw - input.loadKw),
  );
  const reserveSocPct = input.reserveSocPct ?? 15;
  const maximumSocPct = input.maximumSocPct ?? 90;
  const capacityLimitedCharge =
    input.batteryCapacityKwh === undefined
      ? input.batteryPowerKw
      : Math.max(
          0,
          (input.batteryCapacityKwh * (maximumSocPct - input.batterySocPct)) /
            100,
        );
  const capacityLimitedDischarge =
    input.batteryCapacityKwh === undefined
      ? input.batteryPowerKw
      : Math.max(
          0,
          (input.batteryCapacityKwh * (input.batterySocPct - reserveSocPct)) /
            100,
        );
  const chargeKw =
    input.batterySocPct < maximumSocPct
      ? Math.min(
          input.batteryPowerKw,
          capacityLimitedCharge,
          surplus,
          exportHeadroom || surplus,
        )
      : 0;
  const dischargeKw =
    input.batterySocPct > reserveSocPct
      ? Math.min(input.batteryPowerKw, capacityLimitedDischarge, deficit)
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
  const objective =
    -(chargeKw * 0.1) +
    dischargeKw * input.tariff +
    -curtailedKw * input.tariff +
    flexibleLoadKw * input.tariff * 0.5 +
    hydrogenKg * 20 +
    carbonValue;
  const baselineCurtailmentKw = Math.max(0, surplus - input.exportLimitKw);
  const recoveredEnergyKwh = Math.max(
    0,
    baselineCurtailmentKw - remainingCurtailment,
  );
  return {
    chargeKw: Number(chargeKw.toFixed(3)),
    dischargeKw: Number(dischargeKw.toFixed(3)),
    curtailedKw: Number(remainingCurtailment.toFixed(3)),
    flexibleLoadKw: Number(flexibleLoadKw.toFixed(3)),
    hydrogenKg: Number(hydrogenKg.toFixed(3)),
    objective: Number(objective.toFixed(3)),
    baselineCurtailmentKw: Number(baselineCurtailmentKw.toFixed(3)),
    recoveredEnergyKwh: Number(recoveredEnergyKwh.toFixed(3)),
    estimatedRevenueImpact: Number(
      (recoveredEnergyKwh * input.tariff).toFixed(2),
    ),
    constraintsSatisfied:
      input.batterySocPct >= 0 &&
      input.batterySocPct <= 100 &&
      reserveSocPct < maximumSocPct,
    advisoryOnly: true,
  };
}
