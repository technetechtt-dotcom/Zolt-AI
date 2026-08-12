import { prisma } from "../client.js";

function db(): any {
  return prisma as unknown as any;
}

export async function listInstallations(tenantId: string) {
  return db().productInstallation.findMany({
    where: { tenantId, archivedAt: null },
    include: { product: true, devices: true, assets: true },
    orderBy: { name: "asc" }
  });
}

export async function listDevices(tenantId: string, installationId?: string) {
  return db().device.findMany({
    where: { tenantId, archivedAt: null, ...(installationId ? { installationId } : {}) },
    orderBy: { name: "asc" }
  });
}

export async function listAssets(tenantId: string, installationId?: string) {
  return db().asset.findMany({
    where: { tenantId, archivedAt: null, ...(installationId ? { installationId } : {}) },
    orderBy: { name: "asc" }
  });
}

export async function recordUsage(tenantId: string, metric: string, value: number): Promise<void> {
  const period = new Date().toISOString().slice(0, 7);
  await db().usageMeter.upsert({
    where: { tenantId_metric_period: { tenantId, metric, period } },
    update: { value: { increment: value } },
    create: { tenantId, metric, period, value }
  });
}

export async function archiveExpiredRecommendations(): Promise<number> {
  const result = await db().recommendation.updateMany({
    where: { expiresAt: { lt: new Date() }, status: "PROPOSED", archivedAt: null },
    data: { status: "EXPIRED" }
  });
  return result.count as number;
}
