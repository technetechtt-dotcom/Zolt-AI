import { describe, expect, it } from "vitest";
import { optimiseSite } from "../packages/optimisation/src/index.js";

describe("battery degradation economics", () => {
  const base = {
    forecastKw: 200,
    exportLimitKw: 80,
    loadKw: 40,
    batterySocPct: 40,
    batteryPowerKw: 50,
    hydrogenCapacityKgPerHour: 1,
    tariff: 2,
    batteryCapacityKwh: 100,
  };

  it("reduces net revenue when cycle cost is applied", () => {
    const cheap = optimiseSite(base);
    const costly = optimiseSite({
      ...base,
      economics: { cycleCostPerMwh: 400 },
    });
    expect(costly.degradationCost).toBeGreaterThan(cheap.degradationCost);
    expect(costly.netRevenueImpact).toBeLessThan(cheap.netRevenueImpact);
  });

  it("blocks charge when the battery is outside temperature limits", () => {
    const plan = optimiseSite({
      ...base,
      economics: {
        minTemperatureC: 5,
        maxTemperatureC: 45,
        batteryTemperatureC: 55,
      },
    });
    expect(plan.chargeKw).toBe(0);
    expect(plan.dischargeKw).toBe(0);
    expect(plan.constraintsSatisfied).toBe(false);
  });
});
