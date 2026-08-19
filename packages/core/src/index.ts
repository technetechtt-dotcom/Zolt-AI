import { createHash, randomUUID } from "node:crypto";
import type { RecommendationStatus, ZoltRecommendation } from "@zolt/contracts";
import type {
  ZoltContext,
  ZoltExecutionContext,
  ZoltSkill,
} from "@zolt/capability-sdk";
import {
  assertAdvisoryOnlyRuntime,
  assertNoPlantCommand,
  HARDWARE_EXECUTION_FORBIDDEN,
} from "@zolt/safety";

const transitions: Record<RecommendationStatus, RecommendationStatus[]> = {
  PROPOSED: ["ACKNOWLEDGED", "APPROVED", "REJECTED", "EXPIRED", "SUPERSEDED"],
  ACKNOWLEDGED: ["APPROVED", "REJECTED", "EXPIRED", "RESOLVED"],
  APPROVED: ["EXPIRED", "RESOLVED"],
  REJECTED: [],
  EXPIRED: [],
  SUPERSEDED: [],
  RESOLVED: [],
};

export function assertTransition(
  from: RecommendationStatus,
  to: RecommendationStatus,
): void {
  if (!transitions[from].includes(to)) {
    throw new Error(`INVALID_RECOMMENDATION_TRANSITION:${from}->${to}`);
  }
}

export function deduplicationKey(
  parts: Record<string, string | undefined>,
): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function calibrateConfidence(parts: Record<string, number>): number {
  const values = Object.values(parts);
  if (values.length === 0) {
    return 0.5;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.max(0.05, Math.min(0.99, mean));
}

export class AnalysisOrchestrator {
  constructor(private readonly skills: ZoltSkill[]) {}

  async analyse(context: ZoltContext): Promise<ZoltRecommendation[]> {
    assertAdvisoryOnlyRuntime();
    if (!HARDWARE_EXECUTION_FORBIDDEN) {
      throw new Error("SAFETY_POLICY_VIOLATION");
    }
    const minConfidence = Number(process.env.ZOLT_MIN_CONFIDENCE ?? "0");
    const execution: ZoltExecutionContext = {
      runId: randomUUID(),
      correlationId: context.correlationId ?? randomUUID(),
      advisoryOnly: true,
    };
    const output: ZoltRecommendation[] = [];
    const poorQuality = context.telemetry.every((item) =>
      item.measurements.every((measurement) => measurement.quality !== "GOOD"),
    );

    for (const skill of this.skills.filter((candidate) =>
      candidate.supports(context),
    )) {
      try {
        const result = await skill.analyse(context, execution);
        if (!result.recommendation) {
          continue;
        }
        assertNoPlantCommand(result.recommendation.proposedAction);
        const confidence = calibrateConfidence(
          result.recommendation.confidenceBreakdown,
        );
        if (confidence < minConfidence) {
          continue;
        }
        if (poorQuality && result.recommendation.severity === "CRITICAL") {
          result.recommendation.severity = "HIGH";
          result.recommendation.dataQualityWarnings = [
            ...result.recommendation.dataQualityWarnings,
            "Downgraded because input data quality is poor",
          ];
        }
        const now = new Date().toISOString();
        const stableId = deduplicationKey({
          tenantId: result.recommendation.tenantId,
          productId: result.recommendation.productId,
          installationId: result.recommendation.installationId,
          capabilityPack: result.recommendation.capabilityPack,
          skillId: result.recommendation.skillId,
          type: result.recommendation.type,
          ruleVersion: result.recommendation.ruleVersion,
        });
        output.push({
          ...result.recommendation,
          id: stableId,
          confidence,
          status: "PROPOSED",
          inputSnapshotId: randomUUID(),
          createdAt: now,
          updatedAt: now,
          safetyClass: result.recommendation.safetyClass ?? "advisory",
        });
      } catch (error) {
        console.error("SKILL_EXECUTION_FAILED", {
          skillId: skill.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return output;
  }
}

export function assertAdvisoryOnly(execution: { advisoryOnly: boolean }): void {
  if (execution.advisoryOnly !== true) {
    throw new Error("SAFETY_POLICY_VIOLATION");
  }
}

export { validateTelemetryEnvelope } from "./telemetry.js";
export type {
  TelemetryValidationProfile,
  TelemetryValidationResult,
} from "./telemetry.js";
export { assessTelemetryQuality } from "./quality.js";
export type { TelemetryQualityReport } from "./quality.js";
