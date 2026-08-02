import { z } from "zod";

export const MeasurementQuality = z.enum(["GOOD","UNCERTAIN","STALE","INVALID","ESTIMATED","MISSING"]);
export const MeasurementSchema = z.object({
  key: z.string().min(1).max(128), value: z.union([z.number(),z.string(),z.boolean(),z.null()]),
  unit: z.string().max(32).optional(), quality: MeasurementQuality,
  minimumExpected: z.number().optional(), maximumExpected: z.number().optional(),
  metadata: z.record(z.union([z.string(),z.number(),z.boolean()])).optional()
}).strict();
export const TelemetryEnvelopeSchema = z.object({
  schemaVersion: z.literal("1.0"), messageId: z.string().min(8).max(128), tenantId: z.string().min(1),
  productId: z.string().min(1), installationId: z.string().min(1), siteId: z.string().optional(),
  deviceId: z.string().min(1), assetId: z.string().optional(), sourceTimestamp: z.string().datetime(),
  receivedTimestamp: z.string().datetime(), sequenceNumber: z.number().int().nonnegative().optional(),
  correlationId: z.string().optional(), measurements: z.array(MeasurementSchema).min(1).max(1000),
  deviceState: z.record(z.unknown()).optional(), metadata: z.record(z.union([z.string(),z.number(),z.boolean()])).optional()
}).strict();
export type ZoltTelemetryEnvelope = z.infer<typeof TelemetryEnvelopeSchema>;
export type ZoltMeasurement = z.infer<typeof MeasurementSchema>;

export const RecommendationStatus = z.enum(["PROPOSED","ACKNOWLEDGED","APPROVED","REJECTED","EXPIRED","SUPERSEDED","RESOLVED"]);
export type RecommendationStatus = z.infer<typeof RecommendationStatus>;
export interface ZoltEvidence { type:string; label:string; metric?:string; value?:number|string|boolean; unit?:string; timestamp?:string; sourceId?:string; quality?:string; }
export interface ZoltRecommendation { id:string; tenantId:string; productId:string; installationId:string; capabilityPack:string; skillId:string; type:string; title:string; summary:string; proposedAction:string; rationale:string; evidence:ZoltEvidence[]; confidence:number; confidenceBreakdown:Record<string,number>; severity:"INFO"|"LOW"|"MEDIUM"|"HIGH"|"CRITICAL"; priority:number; assumptions:string[]; uncertainties:string[]; dataQualityWarnings:string[]; status:RecommendationStatus; ruleVersion:string; inputSnapshotId:string; validFrom:string; expiresAt:string; createdAt:string; updatedAt:string; }
