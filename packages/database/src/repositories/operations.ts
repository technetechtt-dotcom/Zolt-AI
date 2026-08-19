import { prisma } from "../client.js";
import { writeAuditEvent } from "./audit.js";

function db(): any {
  return prisma as unknown as any;
}

export async function runRetentionJobs(
  now = new Date(),
): Promise<Record<string, number>> {
  const tenants = await db().tenant.findMany({ where: { archivedAt: null } });
  const totals = {
    telemetryArchived: 0,
    recommendationsArchived: 0,
    auditDeleted: 0,
  };
  for (const tenant of tenants) {
    const telemetryCutoff = new Date(
      now.getTime() - tenant.telemetryRetentionDays * 86_400_000,
    );
    const recommendationCutoff = new Date(
      now.getTime() - tenant.recommendationRetentionDays * 86_400_000,
    );
    const auditCutoff = new Date(
      now.getTime() - tenant.auditRetentionDays * 86_400_000,
    );
    const [telemetry, recommendations, audit] = await db().$transaction([
      db().telemetryMessage.updateMany({
        where: {
          tenantId: tenant.id,
          sourceTimestamp: { lt: telemetryCutoff },
          archivedAt: null,
        },
        data: { archivedAt: now },
      }),
      db().recommendation.updateMany({
        where: {
          tenantId: tenant.id,
          createdAt: { lt: recommendationCutoff },
          archivedAt: null,
        },
        data: { archivedAt: now },
      }),
      db().auditEvent.deleteMany({
        where: { tenantId: tenant.id, createdAt: { lt: auditCutoff } },
      }),
    ]);
    totals.telemetryArchived += telemetry.count;
    totals.recommendationsArchived += recommendations.count;
    totals.auditDeleted += audit.count;
  }
  return totals;
}

export async function exportTenantData(
  tenantId: string,
): Promise<Record<string, unknown>> {
  const tenant = await db().tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error("TENANT_NOT_FOUND");
  const [
    products,
    installations,
    devices,
    assets,
    telemetry,
    recommendations,
    auditEvents,
    users,
    webhooks,
    usage,
  ] = await Promise.all([
    db().product.findMany({ where: { tenantId } }),
    db().productInstallation.findMany({ where: { tenantId } }),
    db().device.findMany({ where: { tenantId } }),
    db().asset.findMany({
      where: { tenantId },
      include: { calibrations: true },
    }),
    db().telemetryMessage.findMany({
      where: { tenantId },
      select: {
        id: true,
        messageId: true,
        productId: true,
        installationId: true,
        deviceId: true,
        sourceTimestamp: true,
        receivedTimestamp: true,
        simulated: true,
        schemaVersion: true,
        payload: true,
      },
    }),
    db().recommendation.findMany({ where: { tenantId } }),
    db().auditEvent.findMany({ where: { tenantId } }),
    db().tenantMembership.findMany({
      where: { tenantId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            kind: true,
            createdAt: true,
            archivedAt: true,
            deactivatedAt: true,
          },
        },
        roles: { include: { role: true } },
      },
    }),
    db().webhookEndpoint.findMany({
      where: { tenantId },
      select: {
        id: true,
        url: true,
        events: true,
        status: true,
        createdAt: true,
      },
    }),
    db().usageMeter.findMany({ where: { tenantId } }),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    tenant,
    products,
    installations,
    devices,
    assets,
    telemetry,
    recommendations,
    auditEvents,
    users,
    webhooks,
    usage,
  };
}

export async function offboardTenant(input: {
  tenantId: string;
  actorId: string;
}): Promise<void> {
  const now = new Date();
  await writeAuditEvent({
    tenantId: input.tenantId,
    eventType: "TENANT_OFFBOARDED",
    actorType: "USER",
    actorId: input.actorId,
    subjectType: "TENANT",
    subjectId: input.tenantId,
  });
  await db().$transaction([
    db().session.updateMany({
      where: { tenantId: input.tenantId, revokedAt: null },
      data: { revokedAt: now },
    }),
    db().apiCredential.updateMany({
      where: {
        tenantId: input.tenantId,
        status: { in: ["ACTIVE", "PENDING_APPROVAL"] },
      },
      data: { status: "REVOKED", revokedAt: now },
    }),
    db().webhookEndpoint.updateMany({
      where: { tenantId: input.tenantId },
      data: { status: "DISABLED" },
    }),
    db().productInstallation.updateMany({
      where: { tenantId: input.tenantId },
      data: { status: "ARCHIVED", archivedAt: now },
    }),
    db().tenant.update({
      where: { id: input.tenantId },
      data: { archivedAt: now },
    }),
  ]);
}

export async function deleteOffboardedTenant(tenantId: string): Promise<void> {
  const tenant = await db().tenant.findUnique({ where: { id: tenantId } });
  if (!tenant?.archivedAt) throw new Error("TENANT_MUST_BE_OFFBOARDED_FIRST");
  const roles = await db().role.findMany({
    where: { tenantId },
    select: { id: true },
  });
  const roleIds = roles.map((role: { id: string }) => role.id);
  const endpoints = await db().webhookEndpoint.findMany({
    where: { tenantId },
    select: { id: true },
  });
  const endpointIds = endpoints.map((endpoint: { id: string }) => endpoint.id);
  const memberships = await db().tenantMembership.findMany({
    where: { tenantId },
    select: { userId: true },
  });
  const userIds = memberships.map(
    (membership: { userId: string }) => membership.userId,
  );
  await db().$transaction([
    db().webhookDelivery.deleteMany({
      where: { endpointId: { in: endpointIds } },
    }),
    db().webhookEndpoint.deleteMany({ where: { tenantId } }),
    db().sensorCalibration.deleteMany({ where: { tenantId } }),
    db().telemetryMessage.deleteMany({ where: { tenantId } }),
    db().recommendation.deleteMany({ where: { tenantId } }),
    db().installationAccess.deleteMany({ where: { tenantId } }),
    db().device.deleteMany({ where: { tenantId } }),
    db().asset.deleteMany({ where: { tenantId } }),
    db().apiCredential.deleteMany({ where: { tenantId } }),
    db().session.deleteMany({ where: { tenantId } }),
    db().membershipRole.deleteMany({ where: { tenantId } }),
    db().rolePermission.deleteMany({ where: { roleId: { in: roleIds } } }),
    db().role.deleteMany({ where: { tenantId } }),
    db().tenantMembership.deleteMany({ where: { tenantId } }),
    db().modelRegistry.deleteMany({ where: { tenantId } }),
    db().invoice.deleteMany({ where: { tenantId } }),
    db().slaIncident.deleteMany({ where: { tenantId } }),
    db().usageMeter.deleteMany({ where: { tenantId } }),
    db().auditEvent.deleteMany({ where: { tenantId } }),
    db().productInstallation.deleteMany({ where: { tenantId } }),
    db().product.deleteMany({ where: { tenantId } }),
    db().tenant.delete({ where: { id: tenantId } }),
  ]);
  await db().user.deleteMany({
    where: {
      id: { in: userIds },
      memberships: { none: {} },
    },
  });
}
