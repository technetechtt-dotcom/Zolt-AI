import type { ZoltRecommendation, ZoltTelemetryEnvelope } from "@zolt/contracts";
export interface ZoltContext { tenantId:string; productId:string; installationId:string; siteId?:string; telemetry:ZoltTelemetryEnvelope[]; analysisTime:string; configuration:Record<string,unknown>; }
export interface ZoltExecutionContext { runId:string; correlationId:string; advisoryOnly:true; }
export interface ZoltSkillResult { recommendation?:Omit<ZoltRecommendation,"id"|"createdAt"|"updatedAt"|"status"|"inputSnapshotId">; warnings:string[]; noRecommendationReason?:string; }
export interface ZoltSkill { readonly id:string; readonly version:string; readonly capabilityPack:string; supports(context:ZoltContext):boolean; analyse(context:ZoltContext, execution:ZoltExecutionContext):Promise<ZoltSkillResult>; }
