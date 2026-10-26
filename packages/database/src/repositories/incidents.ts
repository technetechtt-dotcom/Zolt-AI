import { prisma } from "../client.js";
import { writeAuditEvent } from "./audit.js";

function db(): any {
  return prisma as unknown as any;
}

export const INCIDENT_STATUSES = [
  "OPEN",
  "ACKNOWLEDGED",
  "ASSIGNED",
  "INVESTIGATING",
  "MITIGATED",
  "RESOLVED",
  "POST_INCIDENT_REVIEW",
] as const;

export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  OPEN: ["ACKNOWLEDGED", "ASSIGNED", "INVESTIGATING"],
  ACKNOWLEDGED: ["ASSIGNED", "INVESTIGATING", "MITIGATED"],
  ASSIGNED: ["INVESTIGATING", "MITIGATED"],
  INVESTIGATING: ["MITIGATED", "RESOLVED", "ASSIGNED"],
  MITIGATED: ["RESOLVED", "INVESTIGATING"],
  RESOLVED: ["POST_INCIDENT_REVIEW"],
  POST_INCIDENT_REVIEW: [],
};

export async function createIncident(input: {
  tenantId: string;
  title: string;
  summary?: string;
  severity: string;
  productId?: string;
  installationId?: string;
  assetId?: string;
  alertId?: string;
  recommendationIds?: string[];
  telemetryMessageIds?: string[];
  actorId?: string;
}): Promise<Record<string, unknown>> {
  const created = await db().slaIncident.create({
    data: {
      tenantId: input.tenantId,
      title: input.title,
      summary: input.summary ?? "",
      severity: input.severity,
      status: "OPEN",
      productId: input.productId,
      installationId: input.installationId,
      assetId: input.assetId,
      alertId: input.alertId,
      recommendationIds: input.recommendationIds ?? [],
      telemetryMessageIds: input.telemetryMessageIds ?? [],
      comments: [],
    },
  });
  await writeAuditEvent({
    tenantId: input.tenantId,
    eventType: "INCIDENT_OPENED",
    actorType: "USER",
    actorId: input.actorId,
    subjectType: "INCIDENT",
    subjectId: created.id,
  });
  return created;
}

export async function listIncidents(input: {
  tenantId: string;
  status?: string;
  installationId?: string;
}): Promise<unknown[]> {
  return db().slaIncident.findMany({
    where: {
      tenantId: input.tenantId,
      status: input.status,
      installationId: input.installationId,
    },
    orderBy: { startedAt: "desc" },
    take: 200,
  });
}

export async function updateIncident(input: {
  tenantId: string;
  incidentId: string;
  status?: IncidentStatus;
  assignedToId?: string;
  comment?: string;
  actorId?: string;
}): Promise<Record<string, unknown>> {
  const existing = await db().slaIncident.findFirst({
    where: { id: input.incidentId, tenantId: input.tenantId },
  });
  if (!existing) throw new Error("INCIDENT_NOT_FOUND");
  if (input.status && input.status !== existing.status) {
    const allowed = ALLOWED_TRANSITIONS[existing.status as IncidentStatus] ?? [];
    if (!allowed.includes(input.status)) {
      throw new Error(`INCIDENT_TRANSITION_INVALID:${existing.status}->${input.status}`);
    }
  }
  const comments = Array.isArray(existing.comments) ? [...existing.comments] : [];
  if (input.comment) {
    comments.push({
      at: new Date().toISOString(),
      actorId: input.actorId,
      text: input.comment,
    });
  }
  const nextStatus = input.status ?? existing.status;
  const updated = await db().slaIncident.update({
    where: { id: existing.id },
    data: {
      status: nextStatus,
      assignedToId: input.assignedToId ?? existing.assignedToId,
      comments,
      acknowledgedAt:
        nextStatus === "ACKNOWLEDGED"
          ? (existing.acknowledgedAt ?? new Date())
          : existing.acknowledgedAt,
      mitigatedAt:
        nextStatus === "MITIGATED"
          ? (existing.mitigatedAt ?? new Date())
          : existing.mitigatedAt,
      resolvedAt:
        nextStatus === "RESOLVED" || nextStatus === "POST_INCIDENT_REVIEW"
          ? (existing.resolvedAt ?? new Date())
          : existing.resolvedAt,
    },
  });
  await writeAuditEvent({
    tenantId: input.tenantId,
    eventType: "INCIDENT_UPDATED",
    actorType: "USER",
    actorId: input.actorId,
    subjectType: "INCIDENT",
    subjectId: existing.id,
    metadata: { status: nextStatus },
  });
  return updated;
}
