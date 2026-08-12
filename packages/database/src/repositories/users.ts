import { randomBytes } from "node:crypto";
import type { PermissionKey } from "@zolt/contracts";
import { ROLE_PERMISSIONS } from "@zolt/contracts";
import type { AuthenticatedPrincipal } from "@zolt/auth";
import { hashSecret, verifySecret } from "@zolt/auth";
import { prisma } from "../client.js";
import { writeAuditEvent } from "./audit.js";

function db(): any {
  return prisma as unknown as any;
}

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MS = 15 * 60_000;

export async function authenticateUser(input: {
  email: string;
  password: string;
  tenantId?: string;
}): Promise<{ token: string; tenantId: string; userId: string; name: string } | null> {
  const user = await db().user.findUnique({
    where: { email: input.email },
    include: { memberships: true, roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } }
  });
  if (!user || user.archivedAt) {
    return null;
  }
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    throw new Error("ACCOUNT_LOCKED");
  }
  if (!user.passwordHash || !verifySecret(input.password, user.passwordHash)) {
    const failed = (user.failedLogins ?? 0) + 1;
    await db().user.update({
      where: { id: user.id },
      data: {
        failedLogins: failed,
        lockedUntil: failed >= LOCKOUT_THRESHOLD ? new Date(Date.now() + LOCKOUT_MS) : null
      }
    });
    return null;
  }

  const tenantId = input.tenantId ?? user.tenantId ?? user.memberships[0]?.tenantId;
  if (!tenantId) {
    throw new Error("TENANT_REQUIRED");
  }
  const member = user.memberships.some((item: { tenantId: string }) => item.tenantId === tenantId);
  if (!member && user.tenantId !== tenantId) {
    throw new Error("TENANT_MISMATCH");
  }

  await db().user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
  const token = randomBytes(32).toString("base64url");
  await db().session.create({
    data: {
      userId: user.id,
      tenantId,
      tokenHash: hashSecret(token),
      expiresAt: new Date(Date.now() + 12 * 60 * 60_000)
    }
  });
  await writeAuditEvent({
    tenantId,
    eventType: "USER_LOGIN",
    actorType: "USER",
    actorId: user.id,
    subjectType: "SESSION",
    subjectId: user.id
  });
  return { token, tenantId, userId: user.id, name: user.name };
}

export async function resolveSession(token: string): Promise<AuthenticatedPrincipal | null> {
  const sessions = await db().session.findMany({
    where: { revokedAt: null, expiresAt: { gt: new Date() } },
    include: {
      user: {
        include: {
          roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } }
        }
      }
    },
    take: 200
  });
  for (const session of sessions) {
    if (!verifySecret(token, session.tokenHash)) {
      continue;
    }
    const permissions = new Set<PermissionKey>();
    for (const mapping of session.user.roles ?? []) {
      for (const rolePermission of mapping.role.permissions ?? []) {
        permissions.add(rolePermission.permission.key);
      }
    }
    if (permissions.size === 0) {
      ROLE_PERMISSIONS["tenant-administrator"].forEach((item) => permissions.add(item));
    }
    return {
      tenantId: session.tenantId,
      userId: session.userId,
      permissions: [...permissions],
      actorType: "USER"
    };
  }
  return null;
}

export async function revokeSession(token: string): Promise<void> {
  const sessions = await db().session.findMany({ where: { revokedAt: null }, take: 200 });
  for (const session of sessions) {
    if (verifySecret(token, session.tokenHash)) {
      await db().session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return;
    }
  }
}

export async function inviteUser(input: {
  tenantId: string;
  email: string;
  name: string;
  roleKey: string;
  actorId?: string;
}): Promise<string> {
  const user = await db().user.upsert({
    where: { email: input.email },
    update: { name: input.name, invitedAt: new Date(), tenantId: input.tenantId },
    create: {
      email: input.email,
      name: input.name,
      kind: "USER",
      invitedAt: new Date(),
      tenantId: input.tenantId
    }
  });
  await db().tenantMembership.upsert({
    where: { tenantId_userId: { tenantId: input.tenantId, userId: user.id } },
    update: {},
    create: { tenantId: input.tenantId, userId: user.id }
  });
  const role = await db().role.findUnique({ where: { key: input.roleKey } });
  if (role) {
    await db().userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id }
    });
  }
  await writeAuditEvent({
    tenantId: input.tenantId,
    eventType: "USER_INVITED",
    actorType: "USER",
    actorId: input.actorId,
    subjectType: "USER",
    subjectId: user.id,
    metadata: { email: input.email, roleKey: input.roleKey }
  });
  return user.id;
}

export async function listTenantUsers(tenantId: string) {
  return db().user.findMany({
    where: { memberships: { some: { tenantId } } },
    include: { roles: { include: { role: true } } },
    take: 200
  });
}
