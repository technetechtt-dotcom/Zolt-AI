import type { ZoltSkill } from "@zolt/capability-sdk";
import { calibrateConfidence } from "@zolt/core";

function numeric(
  context: {
    telemetry: Array<{ measurements: Array<{ key: string; value: unknown }> }>;
  },
  key: string,
): number | undefined {
  for (const envelope of context.telemetry) {
    for (const measurement of envelope.measurements) {
      if (measurement.key === key && typeof measurement.value === "number") {
        return measurement.value;
      }
    }
  }
  return undefined;
}

export function createEnergySkill(input: {
  id: string;
  type: string;
  title: string;
  metric: string;
  threshold: number;
  compare: "gt" | "lt";
  severity?: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  unit?: string;
}): ZoltSkill {
  return {
    id: input.id,
    version: "0.2.0",
    capabilityPack: "energy",
    supports: (context) =>
      numeric(context, input.metric) !== undefined ||
      Object.keys(context.configuration).length > 0,
    async analyse(context) {
      const value =
        numeric(context, input.metric) ??
        Number(context.configuration[input.metric] ?? Number.NaN);
      const configuredThresholds = context.configuration.thresholds as
        Record<string, unknown> | undefined;
      const manufacturer = String(
        context.telemetry[0]?.vendor ??
          context.configuration.inverterManufacturer ??
          "",
      );
      const manufacturerThresholds = (
        context.configuration.manufacturerThresholds as
          Record<string, Record<string, unknown>> | undefined
      )?.[manufacturer];
      const threshold = Number(
        configuredThresholds?.[input.id] ??
          configuredThresholds?.[input.metric] ??
          manufacturerThresholds?.[input.id] ??
          manufacturerThresholds?.[input.metric] ??
          input.threshold,
      );
      if (!Number.isFinite(value)) {
        return { warnings: [], noRecommendationReason: `No ${input.metric}` };
      }
      const triggered =
        input.compare === "gt" ? value > threshold : value < threshold;
      if (!triggered) {
        return { warnings: [], noRecommendationReason: "Within limits" };
      }
      const breakdown = {
        measurement: 0.75,
        threshold: 0.9,
        dataQuality: context.telemetry.length > 0 ? 0.8 : 0.4,
      };
      const confidence = calibrateConfidence(breakdown);
      return {
        warnings: [],
        recommendation: {
          tenantId: context.tenantId,
          productId: context.productId,
          installationId: context.installationId,
          capabilityPack: "energy",
          skillId: input.id,
          type: input.type,
          title: input.title,
          summary: `${input.metric} is ${value} versus threshold ${threshold}.`,
          proposedAction:
            "Review operating limits and advisory actions with the site operator. Do not issue plant commands.",
          rationale:
            "Rule-based energy intelligence compared live or configured values against approved operating thresholds.",
          evidence: [
            {
              type: "metric",
              label: input.metric,
              metric: input.metric,
              value,
              unit: input.unit,
            },
          ],
          confidence,
          confidenceBreakdown: breakdown,
          severity: input.severity ?? "MEDIUM",
          priority: input.severity === "CRITICAL" ? 95 : 70,
          assumptions: [
            `Threshold ${threshold} ${input.unit ?? ""}`.trim(),
            manufacturer
              ? `Manufacturer profile ${manufacturer}`
              : "Generic asset profile",
          ],
          uncertainties: [
            "Actual plant conditions may differ from sampled telemetry",
          ],
          dataQualityWarnings: context.telemetry.some((item) => item.simulated)
            ? ["Includes simulated telemetry"]
            : [],
          ruleVersion: "0.2.0",
          modelVersion: "rules-v2",
          expectedEnergyKwh: Math.abs(value - input.threshold),
          safetyClass: input.severity === "CRITICAL" ? "high-risk" : "advisory",
          validFrom: context.analysisTime,
          expiresAt: new Date(
            Date.parse(context.analysisTime) + 30 * 60_000,
          ).toISOString(),
        },
      };
    },
  };
}
