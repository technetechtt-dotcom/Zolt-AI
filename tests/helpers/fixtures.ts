import type { ZoltRecommendation, ZoltTelemetryEnvelope } from "../../packages/contracts/src/index.js";

export function createTestTelemetryEnvelope(overrides?: Partial<ZoltTelemetryEnvelope>): ZoltTelemetryEnvelope {
  const now = new Date().toISOString();
  return {
    schemaVersion: "1.0",
    messageId: "message-12345",
    tenantId: "tenant-1",
    productId: "product-1",
    installationId: "installation-1",
    deviceId: "device-1",
    sourceTimestamp: now,
    receivedTimestamp: now,
    measurements: [
      {
        key: "powerKw",
        value: 10.5,
        quality: "GOOD"
      }
    ],
    ...overrides
  };
}

export function createTestRecommendation(overrides?: Partial<ZoltRecommendation>): ZoltRecommendation {
  const now = new Date().toISOString();
  return {
    id: "rec-1",
    tenantId: "tenant-1",
    productId: "product-1",
    installationId: "installation-1",
    capabilityPack: "energy",
    skillId: "energy.curtailment-risk",
    type: "CURTAILMENT_RISK",
    title: "Curtailment risk",
    summary: "Forecast exceeds export limit.",
    proposedAction: "Shift load or dispatch storage.",
    rationale: "Configured forecast is above site export limit.",
    evidence: [{ type: "metric", label: "Forecast power", value: 150, unit: "kW" }],
    confidence: 0.82,
    confidenceBreakdown: { forecast: 0.8, configuration: 1 },
    severity: "MEDIUM",
    priority: 70,
    assumptions: [],
    uncertainties: [],
    dataQualityWarnings: [],
    status: "PROPOSED",
    ruleVersion: "0.1.0",
    inputSnapshotId: "snapshot-1",
    validFrom: now,
    expiresAt: new Date(Date.parse(now) + 3600_000).toISOString(),
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}
