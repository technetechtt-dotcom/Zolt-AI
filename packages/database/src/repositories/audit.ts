import { prisma } from "../client.js";

export interface AuditWriteInput {
  tenantId: string;
  eventType: string;
  actorType: string;
  actorId?: string;
  subjectType: string;
  subjectId: string;
  metadata?: Record<string, unknown>;
  correlationId?: string;
}

export async function writeAuditEvent(input: AuditWriteInput): Promise<void> {
  const db = prisma as unknown as any;
  await db.auditEvent.create({
    data: {
      tenantId: input.tenantId,
      eventType: input.eventType,
      actorType: ["USER", "API", "SYSTEM", "DEVICE", "SERVICE_ACCOUNT"].includes(input.actorType)
        ? input.actorType
        : "SYSTEM",
      actorId: input.actorId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      metadata: input.metadata,
      correlationId: input.correlationId
    }
  });
}

export async function listAuditEvents(tenantId: string, limit = 100): Promise<unknown[]> {
  const db = prisma as unknown as any;
  return db.auditEvent.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: limit
  });
}
