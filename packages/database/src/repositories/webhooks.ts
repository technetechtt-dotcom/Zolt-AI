import { assertSafeWebhookUrl, decryptSecret } from "@zolt/auth";
import { prisma } from "../client.js";
import { writeAuditEvent } from "./audit.js";

function db(): any {
  return prisma as unknown as any;
}

export async function listActiveWebhooks(tenantId: string, eventType: string) {
  const rows = await db().webhookEndpoint.findMany({
    where: { tenantId, status: { in: ["ACTIVE", "FAILING"] } },
  });
  return rows
    .filter((row: any) => {
      const events = row.events as string[];
      return events.includes("*") || events.includes(eventType);
    })
    .map((row: any) => ({
      id: row.id as string,
      url: row.url as string,
      secret: decryptSecret(row.secretEnc),
      failureCount: row.failureCount as number,
    }));
}

export async function recordWebhookDelivery(input: {
  endpointId: string;
  eventType: string;
  idempotencyId: string;
  payload: Record<string, unknown>;
  status: string;
  error?: string;
}): Promise<void> {
  await db().webhookDelivery.upsert({
    where: {
      endpointId_idempotencyId: {
        endpointId: input.endpointId,
        idempotencyId: input.idempotencyId,
      },
    },
    update: {
      status: input.status,
      lastError: input.error,
      attempts: { increment: 1 },
    },
    create: {
      endpointId: input.endpointId,
      eventType: input.eventType,
      idempotencyId: input.idempotencyId,
      payload: input.payload,
      status: input.status,
      lastError: input.error,
      attempts: 1,
    },
  });
}

export async function markWebhookResult(
  endpointId: string,
  ok: boolean,
): Promise<void> {
  if (ok) {
    await db().webhookEndpoint.update({
      where: { id: endpointId },
      data: { lastSuccessAt: new Date(), failureCount: 0, status: "ACTIVE" },
    });
    return;
  }
  const row = await db().webhookEndpoint.update({
    where: { id: endpointId },
    data: {
      lastFailureAt: new Date(),
      failureCount: { increment: 1 },
      status: "FAILING",
    },
  });
  if (row.failureCount >= 10) {
    await db().webhookEndpoint.update({
      where: { id: endpointId },
      data: { status: "DISABLED" },
    });
  }
}

export async function createWebhookEndpoint(input: {
  tenantId: string;
  url: string;
  secretEnc: string;
  events: string[];
}): Promise<string> {
  await assertSafeWebhookUrl(input.url);
  const [tenant, count] = await Promise.all([
    db().tenant.findUnique({
      where: { id: input.tenantId },
      select: { webhookQuota: true },
    }),
    db().webhookEndpoint.count({ where: { tenantId: input.tenantId } }),
  ]);
  if (!tenant) throw new Error("TENANT_NOT_FOUND");
  if (count >= tenant.webhookQuota)
    throw new Error("WEBHOOK_TENANT_QUOTA_EXCEEDED");
  const created = await db().webhookEndpoint.create({
    data: {
      tenantId: input.tenantId,
      url: input.url,
      secretEnc: input.secretEnc,
      events: input.events,
    },
  });
  return created.id as string;
}

export async function rotateWebhookSecret(input: {
  tenantId: string;
  endpointId: string;
  secretEnc: string;
  actorId?: string;
}): Promise<void> {
  const endpoint = await db().webhookEndpoint.findFirst({
    where: { id: input.endpointId, tenantId: input.tenantId },
  });
  if (!endpoint) throw new Error("WEBHOOK_NOT_FOUND");
  await db().webhookEndpoint.update({
    where: { id: endpoint.id },
    data: { secretEnc: input.secretEnc },
  });
  await writeAuditEvent({
    tenantId: input.tenantId,
    eventType: "WEBHOOK_SECRET_ROTATED",
    actorType: "USER",
    actorId: input.actorId,
    subjectType: "WEBHOOK",
    subjectId: endpoint.id,
  });
}

export async function getWebhookForDelivery(
  tenantId: string,
  endpointId: string,
) {
  const endpoint = await db().webhookEndpoint.findFirst({
    where: { id: endpointId, tenantId },
  });
  if (!endpoint) throw new Error("WEBHOOK_NOT_FOUND");
  return {
    id: endpoint.id as string,
    url: endpoint.url as string,
    secret: decryptSecret(endpoint.secretEnc),
  };
}

export async function listWebhookEndpoints(tenantId: string) {
  return db().webhookEndpoint.findMany({
    where: { tenantId },
    select: {
      id: true,
      url: true,
      events: true,
      status: true,
      failureCount: true,
      lastSuccessAt: true,
      lastFailureAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function listWebhookDeliveries(
  tenantId: string,
  endpointId: string,
) {
  const endpoint = await db().webhookEndpoint.findFirst({
    where: { id: endpointId, tenantId },
  });
  if (!endpoint) {
    throw new Error("WEBHOOK_NOT_FOUND");
  }
  return db().webhookDelivery.findMany({
    where: { endpointId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function getWebhookDeliveryForRedelivery(
  tenantId: string,
  deliveryId: string,
) {
  const delivery = await db().webhookDelivery.findFirst({
    where: { id: deliveryId, endpoint: { tenantId } },
    include: { endpoint: true },
  });
  if (!delivery) throw new Error("WEBHOOK_DELIVERY_NOT_FOUND");
  return {
    endpointId: delivery.endpointId as string,
    eventType: delivery.eventType as string,
    payload: delivery.payload as Record<string, unknown>,
    url: delivery.endpoint.url as string,
    secret: decryptSecret(delivery.endpoint.secretEnc),
    originalIdempotencyId: delivery.idempotencyId as string,
  };
}
