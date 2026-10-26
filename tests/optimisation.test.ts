import { describe, expect, it } from "vitest";
import {
  benchmarkStrategies,
  optimiseSite,
} from "../packages/optimisation/src/index.js";
import {
  greedyHorizon,
  optimiseHorizon,
  simulateDispatch,
} from "../packages/optimisation/src/horizon.js";

const site = {
  batteryPowerKw: 50,
  batteryCapacityKwh: 120,
  hydrogenCapacityKgPerHour: 1,
  flexibleLoadLimitKw: 10,
};

describe("operational optimisation", () => {
  it("never emits plant-control flags", () => {
    const plan = optimiseSite({
      forecastKw: 200,
      exportLimitKw: 80,
      loadKw: 40,
      batterySocPct: 40,
      batteryPowerKw: 50,
      hydrogenCapacityKgPerHour: 1,
      tariff: 1.5,
    });
    expect(plan.advisoryOnly).toBe(true);
    expect(plan.constraintsSatisfied).toBe(true);
    expect(plan.chargeKw).toBeGreaterThan(0);
  });

  it("rejects simultaneous charge and discharge in simulation", () => {
    const simulated = simulateDispatch(site, 50, {
      chargeKw: 10,
      dischargeKw: 10,
      curtailedKw: 0,
      flexibleLoadKw: 0,
      hydrogenKg: 0,
      objective: 0,
      baselineCurtailmentKw: 0,
      recoveredEnergyKwh: 0,
      estimatedRevenueImpact: 0,
      degradationCost: 0,
      netRevenueImpact: 0,
      constraintsSatisfied: true,
      advisoryOnly: true,
    });
    expect(simulated.violations).toContain("simultaneous-charge-discharge");
  });

  it("validates a 24-hour horizon against SOC constraints", () => {
    const horizon = Array.from({ length: 24 }, (_, hourUtc) => ({
      hourUtc,
      forecastKw: hourUtc >= 7 && hourUtc <= 14 ? 160 : 8,
      loadKw: hourUtc >= 15 ? 90 : 35,
      exportLimitKw: 100,
      tariff: hourUtc >= 18 && hourUtc <= 21 ? 2.4 : 1.0,
    }));
    const greedy = greedyHorizon(site, 40, horizon);
    const plan = optimiseHorizon(site, 40, horizon);
    expect(plan.advisoryOnly).toBe(true);
    expect(plan.steps).toHaveLength(24);
    expect(plan.constraintsSatisfied).toBe(true);
    expect(plan.recoveredEnergyKwh).toBeGreaterThanOrEqual(0);
    expect(plan.steps.every((step) => step.simulatedSocPct >= 15)).toBe(true);
    expect(plan.steps.every((step) => step.simulatedSocPct <= 90)).toBe(true);
    expect(greedy.advisoryOnly).toBe(true);
    expect(plan.improvementVsGreedy).toBeGreaterThan(0);
    const strategies = benchmarkStrategies({
      forecastKw: 200,
      exportLimitKw: 80,
      loadKw: 40,
      batterySocPct: 40,
      batteryPowerKw: 50,
      hydrogenCapacityKgPerHour: 1,
      tariff: 1.5,
      batteryCapacityKwh: 120,
      economics: { roundTripEfficiency: 0.9, cycleCostPerMwh: 40, maxCRate: 0.8 },
    });
    expect(strategies.zolt.recoveredEnergyKwh).toBeGreaterThanOrEqual(
      strategies["no-action"].recoveredEnergyKwh,
    );
    expect(strategies["offline-optimum"].advisoryOnly).toBe(true);
    expect(
      plan.recoveredEnergyKwh + plan.estimatedRevenueImpact * 0.25,
    ).toBeGreaterThan(
      greedy.recoveredEnergyKwh + greedy.estimatedRevenueImpact * 0.25,
    );
  });
});
