import { z } from "zod";

export const MeasurementQuality = z.enum([
  "GOOD",
  "UNCERTAIN",
  "STALE",
  "INVALID",
  "ESTIMATED",
  "MISSING",
]);
export const SchemaVersion = z.enum(["1.0", "1.1"]);
export const MAX_TELEMETRY_BATCH = 100;
export const MAX_MEASUREMENTS = 500;

const finiteNumber = z
  .number()
  .refine((value) => Number.isFinite(value), "non-finite");

export const MeasurementSchema = z
  .object({
    key: z.string().min(1).max(128),
    value: z.union([finiteNumber, z.string().max(256), z.boolean(), z.null()]),
    unit: z.string().max(32).optional(),
    quality: MeasurementQuality,
    minimumExpected: finiteNumber.optional(),
    maximumExpected: finiteNumber.optional(),
    metadata: z
      .record(z.union([z.string(), finiteNumber, z.boolean()]))
      .optional(),
  })
  .strict();

export const TelemetryEnvelopeSchema = z
  .object({
    schemaVersion: SchemaVersion.default("1.0"),
    messageId: z.string().min(8).max(128),
    tenantId: z.string().min(1),
    productId: z.string().min(1),
    installationId: z.string().min(1),
    siteId: z.string().optional(),
    deviceId: z.string().min(1),
    assetId: z.string().optional(),
    sourceTimestamp: z.string().datetime(),
    receivedTimestamp: z.string().datetime(),
    sequenceNumber: z.number().int().nonnegative().optional(),
    correlationId: z.string().optional(),
    simulated: z.boolean().optional(),
    firmwareVersion: z.string().optional(),
    vendor: z.string().optional(),
    model: z.string().optional(),
    communicationHealth: z.enum(["HEALTHY", "DEGRADED", "FAILED"]).optional(),
    measurements: z.array(MeasurementSchema).min(1).max(MAX_MEASUREMENTS),
    deviceState: z.record(z.unknown()).optional(),
    metadata: z
      .record(z.union([z.string(), finiteNumber, z.boolean()]))
      .optional(),
  })
  .strict();

export type ZoltTelemetryEnvelope = z.infer<typeof TelemetryEnvelopeSchema>;
export type ZoltMeasurement = z.infer<typeof MeasurementSchema>;

export const RecommendationStatus = z.enum([
  "PROPOSED",
  "ACKNOWLEDGED",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "SUPERSEDED",
  "RESOLVED",
]);
export type RecommendationStatus = z.infer<typeof RecommendationStatus>;

export const PermissionKey = z.enum([
  "telemetry:read",
  "telemetry:write",
  "recommendation:read",
  "recommendation:acknowledge",
  "recommendation:approve",
  "recommendation:reject",
  "installation:read",
  "installation:manage",
  "device:read",
  "device:manage",
  "integration:manage",
  "webhook:manage",
  "audit:read",
  "admin:manage",
]);
export type PermissionKey = z.infer<typeof PermissionKey>;

export const RoleKey = z.enum([
  "platform-administrator",
  "tenant-administrator",
  "operations-manager",
  "engineer",
  "technician",
  "operator",
  "analyst",
  "auditor",
  "api-integration",
  "device",
]);
export type RoleKey = z.infer<typeof RoleKey>;

const ALL_PERMISSIONS = PermissionKey.options as unknown as PermissionKey[];

export const ROLE_PERMISSIONS: Record<RoleKey, PermissionKey[]> = {
  "platform-administrator": ALL_PERMISSIONS,
  "tenant-administrator": ALL_PERMISSIONS,
  "operations-manager": [
    "telemetry:read",
    "recommendation:read",
    "recommendation:acknowledge",
    "recommendation:approve",
    "recommendation:reject",
    "installation:read",
    "device:read",
    "audit:read",
  ],
  engineer: [
    "telemetry:read",
    "recommendation:read",
    "recommendation:acknowledge",
    "installation:read",
    "installation:manage",
    "device:read",
    "device:manage",
  ],
  technician: [
    "telemetry:read",
    "recommendation:read",
    "recommendation:acknowledge",
    "installation:read",
    "device:read",
  ],
  operator: [
    "telemetry:read",
    "recommendation:read",
    "recommendation:acknowledge",
    "installation:read",
    "device:read",
  ],
  analyst: [
    "telemetry:read",
    "recommendation:read",
    "installation:read",
    "audit:read",
  ],
  auditor: [
    "telemetry:read",
    "recommendation:read",
    "installation:read",
    "audit:read",
  ],
  "api-integration": [
    "telemetry:read",
    "telemetry:write",
    "recommendation:read",
    "recommendation:acknowledge",
    "recommendation:approve",
    "recommendation:reject",
    "installation:read",
    "integration:manage",
    "webhook:manage",
  ],
  device: ["telemetry:write"],
};

export interface ZoltEvidence {
  type: string;
  label: string;
  metric?: string;
  value?: number | string | boolean;
  unit?: string;
  timestamp?: string;
  sourceId?: string;
  quality?: string;
}

export interface ZoltRecommendation {
  id: string;
  tenantId: string;
  productId: string;
  installationId: string;
  capabilityPack: string;
  skillId: string;
  type: string;
  title: string;
  summary: string;
  proposedAction: string;
  rationale: string;
  evidence: ZoltEvidence[];
  confidence: number;
  confidenceBreakdown: Record<string, number>;
  severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  priority: number;
  assumptions: string[];
  uncertainties: string[];
  dataQualityWarnings: string[];
  status: RecommendationStatus;
  ruleVersion: string;
  modelVersion?: string;
  inputSnapshotId: string;
  expectedEnergyKwh?: number;
  expectedRevenue?: number;
  expectedCarbonKg?: number;
  actionDeadline?: string;
  safetyClass?: string;
  validFrom: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export const PHYSICAL_RANGES: Record<
  string,
  { min: number; max: number; unit?: string }
> = {
  powerKw: { min: -50, max: 5000, unit: "kW" },
  voltage: { min: 0, max: 1500, unit: "V" },
  frequencyHz: { min: 45, max: 65, unit: "Hz" },
  currentA: { min: -2000, max: 2000, unit: "A" },
  temperatureC: { min: -40, max: 120, unit: "C" },
  socPct: { min: 0, max: 100, unit: "%" },
  powerFactor: { min: -1, max: 1 },
};
