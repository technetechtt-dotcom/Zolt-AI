import { decryptSecret } from "@zolt/auth";
import { prisma } from "../client.js";

function db(): any {
  return prisma as unknown as any;
}

export async function listActiveWebhooks(tenantId: string, eventType: string) {
  const rows = await db().webhookEndpoint.findMany({
    where: { tenantId, status: { in: ["ACTIVE", "FAILING"] } }
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
      failureCount: row.failureCount as number
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
        idempotencyId: input.idempotencyId
      }
    },
    update: {
      status: input.status,
      lastError: input.error,
      attempts: { increment: 1 }
    },
    create: {
      endpointId: input.endpointId,
      eventType: input.eventType,
      idempotencyId: input.idempotencyId,
      payload: input.payload,
      status: input.status,
      lastError: input.error,
      attempts: 1
    }
  });
}

export async function markWebhookResult(endpointId: string, ok: boolean): Promise<void> {
  if (ok) {
    await db().webhookEndpoint.update({
      where: { id: endpointId },
      data: { lastSuccessAt: new Date(), failureCount: 0, status: "ACTIVE" }
    });
    return;
  }
  const row = await db().webhookEndpoint.update({
    where: { id: endpointId },
    data: { lastFailureAt: new Date(), failureCount: { increment: 1 }, status: "FAILING" }
  });
  if (row.failureCount >= 10) {
    await db().webhookEndpoint.update({
      where: { id: endpointId },
      data: { status: "DISABLED" }
    });
  }
}

export async function createWebhookEndpoint(input: {
  tenantId: string;
  url: string;
  secretEnc: string;
  events: string[];
}): Promise<string> {
  const created = await db().webhookEndpoint.create({
    data: {
      tenantId: input.tenantId,
      url: input.url,
      secretEnc: input.secretEnc,
      events: input.events
    }
  });
  return created.id as string;
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
      createdAt: true
    },
    orderBy: { createdAt: "desc" }
  });
}

export async function listWebhookDeliveries(tenantId: string, endpointId: string) {
  const endpoint = await db().webhookEndpoint.findFirst({ where: { id: endpointId, tenantId } });
  if (!endpoint) {
    throw new Error("WEBHOOK_NOT_FOUND");
  }
  return db().webhookDelivery.findMany({
    where: { endpointId },
    orderBy: { createdAt: "desc" },
    take: 100
  });
}
