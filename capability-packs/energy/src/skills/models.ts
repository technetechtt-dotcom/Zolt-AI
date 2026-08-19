import type { ZoltSkill } from "@zolt/capability-sdk";
import {
  curtailmentForecastKw,
  inverterHealthScore,
  revenueLoss,
  solarForecastWithConfidence,
  zScores,
} from "@zolt/analytics";
import { optimiseSite } from "@zolt/optimisation";
import { calibrateConfidence } from "@zolt/core";

function series(
  context: {
    telemetry: Array<{ measurements: Array<{ key: string; value: unknown }> }>;
  },
  key: string,
): number[] {
  const values: number[] = [];
  for (const envelope of context.telemetry) {
    for (const measurement of envelope.measurements) {
      if (measurement.key === key && typeof measurement.value === "number") {
        values.push(measurement.value);
      }
    }
  }
  return values;
}

function base(context: {
  tenantId: string;
  productId: string;
  installationId: string;
  analysisTime: string;
}) {
  return {
    tenantId: context.tenantId,
    productId: context.productId,
    installationId: context.installationId,
    capabilityPack: "energy",
    validFrom: context.analysisTime,
    expiresAt: new Date(
      Date.parse(context.analysisTime) + 30 * 60_000,
    ).toISOString(),
  };
}

export const productionForecastSkill: ZoltSkill = {
  id: "energy.production-forecast-model",
  version: "1.0.0",
  capabilityPack: "energy",
  supports: (context) =>
    Number(context.configuration.capacityKw ?? 0) > 0 ||
    series(context, "powerKw").length > 0,
  async analyse(context) {
    const capacity = Number(context.configuration.capacityKw ?? 100);
    const hour = new Date(context.analysisTime).getUTCHours();
    const cloud = Number(
      context.configuration.cloudCover ??
        context.configuration.cloudFactor ??
        0.2,
    );
    const forecast = solarForecastWithConfidence({
      capacityKw: capacity,
      hourUtc: hour,
      cloudCover: cloud,
      irradianceWm2:
        context.configuration.irradianceWm2 === undefined
          ? undefined
          : Number(context.configuration.irradianceWm2),
      temperatureC:
        context.configuration.temperatureC === undefined
          ? undefined
          : Number(context.configuration.temperatureC),
      historicalErrorStdKw:
        context.configuration.historicalErrorStdKw === undefined
          ? undefined
          : Number(context.configuration.historicalErrorStdKw),
    });
    const live = series(context, "powerKw")[0] ?? 0;
    const breakdown = { model: 0.78, capacity: 0.9, weather: 1 - cloud };
    return {
      warnings: context.telemetry.some((item) => item.simulated)
        ? ["Forecast used simulated telemetry"]
        : [],
      recommendation: {
        ...base(context),
        skillId: "energy.production-forecast-model",
        type: "PRODUCTION_FORECAST",
        title: "Solar production forecast",
        summary: `Forecast ${forecast.forecastKw} kW (95% interval ${forecast.lowerKw}–${forecast.upperKw} kW) versus live ${live} kW.`,
        proposedAction:
          "Review export and storage plans against the forecast. Do not issue plant commands.",
        rationale:
          "Clear-sky shaped solar model scaled by configured capacity and cloud factor.",
        evidence: [
          {
            type: "metric",
            label: "Forecast",
            value: forecast.forecastKw,
            unit: "kW",
          },
          {
            type: "metric",
            label: "Clear-sky baseline",
            value: forecast.baselineKw,
            unit: "kW",
          },
          { type: "metric", label: "Live power", value: live, unit: "kW" },
        ],
        confidence: calibrateConfidence(breakdown),
        confidenceBreakdown: breakdown,
        severity: "INFO",
        priority: 40,
        assumptions: [`Capacity ${capacity} kW`, `Cloud factor ${cloud}`],
        uncertainties: ["Cloud cover and soiling are estimated"],
        dataQualityWarnings: [],
        ruleVersion: "1.0.0",
        modelVersion: "solar-clearsky-v1",
        expectedEnergyKwh: forecast.forecastKw,
        safetyClass: "advisory",
      },
    };
  },
};

export const inverterHealthModelSkill: ZoltSkill = {
  id: "energy.inverter-health-model",
  version: "1.0.0",
  capabilityPack: "energy",
  supports: (context) =>
    series(context, "powerKw").length >= 3 ||
    series(context, "temperatureC").length >= 3,
  async analyse(context) {
    const power = series(context, "powerKw");
    const temps = series(context, "temperatureC");
    const expected = power.map((value) => value * 1.05);
    const health = inverterHealthScore({
      temperatures: temps.length ? temps : power.map(() => 40),
      power,
      expectedPower: expected,
    });
    if (!health.anomaly) {
      return {
        warnings: [],
        noRecommendationReason: "Inverter health within baseline",
      };
    }
    const breakdown = {
      residual: health.score,
      temperature: temps.length ? 0.8 : 0.4,
    };
    return {
      warnings: [],
      recommendation: {
        ...base(context),
        skillId: "energy.inverter-health-model",
        type: "PREDICTIVE_MAINTENANCE",
        title: "Inverter health anomaly",
        summary: `Health score ${(health.score * 100).toFixed(0)}%. Estimated remaining useful life ${health.remainingUsefulLifeDays} days.`,
        proposedAction:
          "Schedule inspection and compare against the last maintenance record. Do not issue plant commands.",
        rationale:
          "Z-score residuals versus expected power and temperature baseline.",
        evidence: [
          { type: "metric", label: "Health score", value: health.score },
        ],
        confidence: calibrateConfidence(breakdown),
        confidenceBreakdown: breakdown,
        severity: "HIGH",
        priority: 85,
        assumptions: [
          "Expected power is 5% above sampled power as a conservative baseline",
        ],
        uncertainties: [
          "Without a long history the remaining-life estimate is coarse",
        ],
        dataQualityWarnings: [],
        ruleVersion: "1.0.0",
        modelVersion: "inverter-health-zscore-v1",
        safetyClass: "high-risk",
      },
    };
  },
};

export const revenueLossModelSkill: ZoltSkill = {
  id: "energy.revenue-loss-model",
  version: "1.0.0",
  capabilityPack: "energy",
  supports: (context) => Number(context.configuration.exportLimitKw ?? 0) > 0,
  async analyse(context) {
    const forecast = Number(
      context.configuration.forecastPowerKw ??
        series(context, "powerKw")[0] ??
        0,
    );
    const limit = Number(context.configuration.exportLimitKw ?? 0);
    const curtailed = curtailmentForecastKw(forecast, limit);
    if (curtailed <= 0) {
      return {
        warnings: [],
        noRecommendationReason: "No curtailment forecast",
      };
    }
    const tariff = Number(context.configuration.tariff ?? 1.2);
    const loss = revenueLoss(curtailed, tariff);
    const plan = optimiseSite({
      forecastKw: forecast,
      exportLimitKw: limit,
      loadKw: Number(context.configuration.loadKw ?? 0),
      batterySocPct: Number(context.configuration.batterySocPct ?? 50),
      batteryPowerKw: Number(context.configuration.batteryPowerKw ?? 50),
      hydrogenCapacityKgPerHour: Number(
        context.configuration.hydrogenCapacityKgPerHour ?? 0,
      ),
      tariff,
    });
    const scores = zScores(series(context, "powerKw").concat([forecast]));
    const breakdown = {
      curtailment: 0.85,
      tariff: 0.7,
      residual: scores.length ? 0.6 : 0.4,
    };
    return {
      warnings: [],
      recommendation: {
        ...base(context),
        skillId: "energy.revenue-loss-model",
        type: "REVENUE_LOSS",
        title: "Curtailment revenue-loss forecast",
        summary: `Forecast curtailment ${curtailed} kW (~ZAR ${loss}/h). Advisory storage charge ${plan.chargeKw} kW.`,
        proposedAction:
          "Review storage, flexible load or hydrogen offtake with the operator. Do not issue plant commands.",
        rationale:
          "Export-limit forecast combined with a multi-objective advisory optimiser.",
        evidence: [
          { type: "metric", label: "Curtailed", value: curtailed, unit: "kW" },
          { type: "metric", label: "Revenue loss", value: loss, unit: "ZAR/h" },
        ],
        confidence: calibrateConfidence(breakdown),
        confidenceBreakdown: breakdown,
        severity: "MEDIUM",
        priority: 75,
        assumptions: [`Tariff ${tariff} ZAR/kWh`],
        uncertainties: [
          "Market price and actual dispatch constraints may differ",
        ],
        dataQualityWarnings: [],
        ruleVersion: "1.0.0",
        modelVersion: "curtailment-revenue-v1",
        expectedEnergyKwh: curtailed,
        expectedRevenue: loss,
        safetyClass: "advisory",
      },
    };
  },
};
