import type { RecommendationStatus, ZoltRecommendation } from "@zolt/contracts";
import { assertTransition } from "@zolt/core";
import { prisma } from "../client.js";
import {
  ensureInstallationIdentity,
  resolveInstallationIdentity,
  resolveProductIdentity
} from "./installations.js";

export async function saveRecommendations(recommendations: ZoltRecommendation[]): Promise<void> {
  const db = prisma as unknown as any;
  for (const recommendation of recommendations) {
    const ids = await ensureInstallationIdentity({
      tenantKey: recommendation.tenantId,
      productKey: recommendation.productId,
      installationKey: recommendation.installationId
    });

    const existing = await db.recommendation.findFirst({
      where: {
        tenantId: ids.tenantId,
        productId: ids.productId,
        installationId: ids.installationId,
        capabilityPack: recommendation.capabilityPack,
        skillId: recommendation.skillId,
        type: recommendation.type,
        status: "PROPOSED"
      },
      orderBy: { createdAt: "desc" }
    });

    await db.recommendation.upsert({
      where: { id: existing?.id ?? recommendation.id },
      update: {
        title: recommendation.title,
        summary: recommendation.summary,
        proposedAction: recommendation.proposedAction,
        rationale: recommendation.rationale,
        confidence: recommendation.confidence,
        confidenceBreakdown: recommendation.confidenceBreakdown,
        severity: recommendation.severity,
        priority: recommendation.priority,
        status: recommendation.status,
        evidence: recommendation.evidence,
        assumptions: recommendation.assumptions,
        uncertainties: recommendation.uncertainties,
        dataQualityWarnings: recommendation.dataQualityWarnings,
        ruleVersion: recommendation.ruleVersion,
        inputSnapshotId: recommendation.inputSnapshotId,
        validFrom: new Date(recommendation.validFrom),
        expiresAt: new Date(recommendation.expiresAt)
      },
      create: {
        id: existing?.id ?? recommendation.id,
        tenantId: ids.tenantId,
        productId: ids.productId,
        installationId: ids.installationId,
        capabilityPack: recommendation.capabilityPack,
        skillId: recommendation.skillId,
        type: recommendation.type,
        title: recommendation.title,
        summary: recommendation.summary,
        proposedAction: recommendation.proposedAction,
        rationale: recommendation.rationale,
        confidence: recommendation.confidence,
        confidenceBreakdown: recommendation.confidenceBreakdown,
        severity: recommendation.severity,
        priority: recommendation.priority,
        status: recommendation.status,
        evidence: recommendation.evidence,
        assumptions: recommendation.assumptions,
        uncertainties: recommendation.uncertainties,
        dataQualityWarnings: recommendation.dataQualityWarnings,
        ruleVersion: recommendation.ruleVersion,
        inputSnapshotId: recommendation.inputSnapshotId,
        validFrom: new Date(recommendation.validFrom),
        expiresAt: new Date(recommendation.expiresAt),
        createdAt: new Date(recommendation.createdAt),
        updatedAt: new Date(recommendation.updatedAt)
      }
    });
  }
}

export async function updateRecommendationStatus(input: {
  tenantId: string;
  recommendationId: string;
  status: RecommendationStatus;
}): Promise<void> {
  const db = prisma as unknown as any;
  const existing = await db.recommendation.findFirst({
    where: {
      id: input.recommendationId,
      tenantId: input.tenantId
    }
  });

  if (!existing) {
    throw new Error("RECOMMENDATION_NOT_FOUND");
  }

  const from = existing.status as RecommendationStatus;
  assertTransition(from, input.status);

  await db.recommendation.update({
    where: { id: existing.id },
    data: { status: input.status }
  });
}

export async function listRecommendations(input: {
  tenantId: string;
  productId?: string;
  installationId?: string;
  status?: RecommendationStatus;
  limit?: number;
}): Promise<ZoltRecommendation[]> {
  const db = prisma as unknown as any;
  let productId: string | undefined;
  let installationId: string | undefined;

  if (input.productId && input.installationId) {
    const ids = await resolveInstallationIdentity({
      tenantKey: input.tenantId,
      productKey: input.productId,
      installationKey: input.installationId
    });
    productId = ids.productId;
    installationId = ids.installationId;
  } else if (input.productId) {
    const product = await resolveProductIdentity({
      tenantKey: input.tenantId,
      productKey: input.productId
    });
    productId = product.productId;
  } else if (input.installationId) {
    throw new Error("INVALID_RECOMMENDATION_FILTER");
  }

  const where: Record<string, unknown> = {
    tenantId: input.tenantId,
    status: input.status
  };
  if (productId) {
    where.productId = productId;
  }
  if (installationId) {
    where.installationId = installationId;
  }

  const rows = await db.recommendation.findMany({
    where,
    include: {
      installation: {
        include: {
          product: true
        }
      }
    },
    orderBy: { createdAt: "desc" },
    take: input.limit ?? 100
  });

  return rows.map((row: any) => ({
    id: row.id,
    tenantId: row.tenantId,
    productId: row.installation?.product?.externalKey ?? row.installation?.product?.key ?? row.productId,
    installationId: row.installation?.externalKey ?? row.installationId,
    capabilityPack: row.capabilityPack,
    skillId: row.skillId,
    type: row.type,
    title: row.title,
    summary: row.summary,
    proposedAction: row.proposedAction,
    rationale: row.rationale,
    evidence: row.evidence as ZoltRecommendation["evidence"],
    confidence: row.confidence,
    confidenceBreakdown: row.confidenceBreakdown as Record<string, number>,
    severity: row.severity as ZoltRecommendation["severity"],
    priority: row.priority,
    assumptions: row.assumptions as string[],
    uncertainties: row.uncertainties as string[],
    dataQualityWarnings: row.dataQualityWarnings as string[],
    status: row.status as RecommendationStatus,
    ruleVersion: row.ruleVersion,
    inputSnapshotId: row.inputSnapshotId,
    validFrom: row.validFrom.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }));
}
