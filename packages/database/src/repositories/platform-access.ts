import { writeAuditEvent } from "./audit.js";

export interface PrivilegedGrant {
  userId: string;
  tenantId?: string;
  reason: string;
  kind: "jit" | "break-glass";
  until: number;
  requestedAt: string;
}

const grants = new Map<string, PrivilegedGrant>();

function key(userId: string): string {
  return userId;
}

export function requestPrivilegedAccess(input: {
  userId: string;
  tenantId?: string;
  reason: string;
  minutes?: number;
  kind?: "jit" | "break-glass";
}): PrivilegedGrant {
  const reason = input.reason.trim();
  if (reason.length < 12) throw new Error("ACCESS_REASON_REQUIRED");
  const minutes = Math.min(240, Math.max(15, input.minutes ?? 60));
  const grant: PrivilegedGrant = {
    userId: input.userId,
    tenantId: input.tenantId,
    reason,
    kind: input.kind ?? "jit",
    until: Date.now() + minutes * 60_000,
    requestedAt: new Date().toISOString(),
  };
  grants.set(key(input.userId), grant);
  void writeAuditEvent({
    tenantId: input.tenantId ?? "platform",
    eventType:
      grant.kind === "break-glass"
        ? "PLATFORM_BREAK_GLASS"
        : "PLATFORM_JIT_ELEVATION",
    actorType: "USER",
    actorId: input.userId,
    subjectType: "TENANT",
    subjectId: input.tenantId ?? "unscoped",
    metadata: { reason, minutes, until: new Date(grant.until).toISOString() },
  });
  return grant;
}

export function activePrivilegedAccess(userId: string): PrivilegedGrant | null {
  const grant = grants.get(key(userId));
  if (!grant) return null;
  if (grant.until <= Date.now()) {
    grants.delete(key(userId));
    return null;
  }
  return grant;
}

export function platformOperatorSessionHours(isProduction: boolean): number {
  if (process.env.ZOLT_PLATFORM_OPERATOR_SESSION_HOURS) {
    return Number(process.env.ZOLT_PLATFORM_OPERATOR_SESSION_HOURS);
  }
  return isProduction ? 2 : 12;
}
