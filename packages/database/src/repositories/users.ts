import { createHash, randomBytes } from "node:crypto";
import type { PermissionKey } from "@zolt/contracts";
import type { AuthenticatedPrincipal } from "@zolt/auth";
import {
  assertPasswordPolicy,
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashSecret,
  totpUri,
  verifySecret,
  verifyTotp,
} from "@zolt/auth";
import { prisma } from "../client.js";
import { writeAuditEvent } from "./audit.js";

function db(): any {
  return prisma as unknown as any;
}

const LOCKOUT_THRESHOLD = Number(process.env.ZOLT_LOCKOUT_THRESHOLD ?? 5);
const LOCKOUT_MS = Number(process.env.ZOLT_LOCKOUT_MINUTES ?? 15) * 60_000;

interface LoginResult {
  token: string;
  tenantId: string;
  userId: string;
  name: string;
}

function sessionTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const sessionMembershipInclude = {
  membership: {
    include: {
      user: true,
      roles: {
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
        },
      },
    },
  },
};

async function findSessionByToken(token: string, requireUnexpired = true) {
  const activeWhere = {
    revokedAt: null,
    ...(requireUnexpired ? { expiresAt: { gt: new Date() } } : {}),
  };
  const exact = await db().session.findFirst({
    where: { tokenHash: sessionTokenHash(token), ...activeWhere },
    include: sessionMembershipInclude,
  });
  if (exact) return exact;

  // Transitional lookup for sessions issued before deterministic token digests.
  const legacy = await db().session.findMany({
    where: { tokenHash: { contains: ":" }, ...activeWhere },
    include: sessionMembershipInclude,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return legacy.find((session: { tokenHash: string }) =>
    verifySecret(token, session.tokenHash),
  );
}

async function useRecoveryCode(userId: string, code: string): Promise<boolean> {
  const rows = await db().mfaRecoveryCode.findMany({
    where: { userId, usedAt: null },
    take: 20,
  });
  for (const row of rows) {
    if (verifySecret(code.toUpperCase(), row.codeHash)) {
      await db().mfaRecoveryCode.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      });
      return true;
    }
  }
  return false;
}

export async function authenticateUser(input: {
  email: string;
  password: string;
  tenantId?: string;
  totpCode?: string;
  recoveryCode?: string;
  deviceName?: string;
  userAgent?: string;
  ipAddress?: string;
}): Promise<LoginResult | null> {
  const user = await db().user.findUnique({
    where: { email: input.email.toLowerCase() },
    include: {
      memberships: {
        include: {
          roles: {
            include: {
              role: {
                include: { permissions: { include: { permission: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!user || user.archivedAt || user.deactivatedAt) return null;
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date())
    throw new Error("ACCOUNT_LOCKED");
  if (!user.passwordHash || !verifySecret(input.password, user.passwordHash)) {
    const failed = (user.failedLogins ?? 0) + 1;
    await db().user.update({
      where: { id: user.id },
      data: {
        failedLogins: failed,
        lockedUntil:
          failed >= LOCKOUT_THRESHOLD
            ? new Date(Date.now() + LOCKOUT_MS)
            : null,
      },
    });
    return null;
  }

  if (
    process.env.NODE_ENV === "production" &&
    process.env.ZOLT_REQUIRE_VERIFIED_EMAIL !== "false" &&
    !user.emailVerifiedAt
  ) {
    throw new Error("EMAIL_NOT_VERIFIED");
  }

  if (user.mfaEnabled) {
    const validTotp = Boolean(
      input.totpCode &&
      user.mfaSecret &&
      verifyTotp(decryptSecret(user.mfaSecret), input.totpCode),
    );
    const validRecovery = Boolean(
      input.recoveryCode &&
      (await useRecoveryCode(user.id, input.recoveryCode)),
    );
    if (!validTotp && !validRecovery) throw new Error("MFA_REQUIRED");
  }

  const membership = input.tenantId
    ? user.memberships.find(
        (item: { tenantId: string }) => item.tenantId === input.tenantId,
      )
    : user.memberships[0];
  if (!membership)
    throw new Error(input.tenantId ? "TENANT_MISMATCH" : "TENANT_REQUIRED");

  const now = new Date();
  await db().user.update({
    where: { id: user.id },
    data: {
      failedLogins: 0,
      lockedUntil: null,
      lastLoginAt: now,
      lastActiveAt: now,
    },
  });
  const token = randomBytes(32).toString("base64url");
  await db().session.create({
    data: {
      userId: user.id,
      tenantId: membership.tenantId,
      tokenHash: sessionTokenHash(token),
      deviceName: input.deviceName,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      lastSeenAt: now,
      expiresAt: new Date(
        Date.now() + Number(process.env.ZOLT_SESSION_HOURS ?? 12) * 60 * 60_000,
      ),
    },
  });
  await writeAuditEvent({
    tenantId: membership.tenantId,
    eventType: "USER_LOGIN",
    actorType: "USER",
    actorId: user.id,
    subjectType: "SESSION",
    subjectId: user.id,
    metadata: {
      deviceName: input.deviceName,
      ipAddress: input.ipAddress,
      mfa: user.mfaEnabled,
    },
  });
  return {
    token,
    tenantId: membership.tenantId,
    userId: user.id,
    name: user.name,
  };
}

export async function resolveSession(
  token: string,
): Promise<AuthenticatedPrincipal | null> {
  const session = await findSessionByToken(token);
  if (session) {
    if (
      session.membership.user.archivedAt ||
      session.membership.user.deactivatedAt
    )
      return null;
    const permissions = new Set<PermissionKey>();
    for (const mapping of session.membership.roles ?? []) {
      if (
        mapping.tenantId !== session.tenantId ||
        mapping.role?.tenantId !== session.tenantId
      )
        continue;
      for (const rolePermission of mapping.role.permissions ?? [])
        permissions.add(rolePermission.permission.key);
    }
    const now = new Date();
    await Promise.all([
      db().session.update({
        where: { id: session.id },
        data: { lastSeenAt: now },
      }),
      db().user.update({
        where: { id: session.userId },
        data: { lastActiveAt: now },
      }),
    ]);
    return {
      tenantId: session.tenantId,
      userId: session.userId,
      permissions: [...permissions],
      actorType: "USER",
    };
  }
  return null;
}

export async function revokeSession(token: string): Promise<void> {
  const session = await findSessionByToken(token, false);
  if (!session) return;
  await db().session.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });
  await writeAuditEvent({
    tenantId: session.tenantId,
    eventType: "SESSION_REVOKED",
    actorType: "USER",
    actorId: session.userId,
    subjectType: "SESSION",
    subjectId: session.id,
  });
}

export async function switchTenantSession(input: {
  token: string;
  tenantId: string;
}): Promise<LoginResult> {
  const session = await findSessionByToken(input.token);
  if (session) {
    const membership = await db().tenantMembership.findUnique({
      where: {
        tenantId_userId: { tenantId: input.tenantId, userId: session.userId },
      },
      include: { user: true },
    });
    if (
      !membership ||
      membership.user.deactivatedAt ||
      membership.user.archivedAt
    )
      throw new Error("TENANT_MISMATCH");
    const token = randomBytes(32).toString("base64url");
    await db().$transaction([
      db().session.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      }),
      db().session.create({
        data: {
          userId: session.userId,
          tenantId: input.tenantId,
          tokenHash: sessionTokenHash(token),
          deviceName: session.deviceName,
          userAgent: session.userAgent,
          ipAddress: session.ipAddress,
          expiresAt: new Date(
            Date.now() +
              Number(process.env.ZOLT_SESSION_HOURS ?? 12) * 60 * 60_000,
          ),
        },
      }),
    ]);
    await writeAuditEvent({
      tenantId: input.tenantId,
      eventType: "TENANT_SESSION_SWITCHED",
      actorType: "USER",
      actorId: session.userId,
      subjectType: "TENANT",
      subjectId: input.tenantId,
    });
    return {
      token,
      tenantId: input.tenantId,
      userId: session.userId,
      name: membership.user.name,
    };
  }
  throw new Error("SESSION_NOT_FOUND");
}

export async function listUserTenants(input: {
  tenantId: string;
  userId: string;
}) {
  const current = await db().tenantMembership.findUnique({
    where: {
      tenantId_userId: { tenantId: input.tenantId, userId: input.userId },
    },
  });
  if (!current) throw new Error("TENANT_MISMATCH");
  return db().tenantMembership.findMany({
    where: { userId: input.userId },
    include: {
      tenant: { select: { id: true, name: true, plan: true, region: true } },
      roles: { include: { role: true } },
    },
  });
}

export async function revokeSessionById(input: {
  tenantId: string;
  userId: string;
  sessionId: string;
  actorId: string;
}): Promise<void> {
  const session = await db().session.findFirst({
    where: {
      id: input.sessionId,
      tenantId: input.tenantId,
      userId: input.userId,
    },
  });
  if (!session) throw new Error("SESSION_NOT_FOUND");
  await db().session.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });
  await writeAuditEvent({
    tenantId: input.tenantId,
    eventType: "SESSION_REVOKED_BY_ADMIN",
    actorType: "USER",
    actorId: input.actorId,
    subjectType: "SESSION",
    subjectId: session.id,
    metadata: { userId: input.userId },
  });
}

export async function revokeAllUserSessions(input: {
  tenantId: string;
  userId: string;
  actorId: string;
}): Promise<number> {
  const result = await db().session.updateMany({
    where: { tenantId: input.tenantId, userId: input.userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await writeAuditEvent({
    tenantId: input.tenantId,
    eventType: "ALL_SESSIONS_REVOKED",
    actorType: "USER",
    actorId: input.actorId,
    subjectType: "USER",
    subjectId: input.userId,
    metadata: { count: result.count },
  });
  return result.count;
}

export async function listUserSessions(input: {
  tenantId: string;
  userId: string;
}) {
  return db().session.findMany({
    where: { tenantId: input.tenantId, userId: input.userId },
    select: {
      id: true,
      deviceName: true,
      userAgent: true,
      ipAddress: true,
      lastSeenAt: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
    },
    orderBy: { lastSeenAt: "desc" },
    take: 100,
  });
}

async function issueAccountToken(
  userId: string,
  purpose: string,
  ttlMs: number,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db().accountToken.create({
    data: {
      userId,
      purpose,
      tokenHash: hashSecret(token),
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });
  return token;
}

async function consumeAccountToken(
  token: string,
  purpose: string,
): Promise<any> {
  const rows = await db().accountToken.findMany({
    where: { purpose, usedAt: null, expiresAt: { gt: new Date() } },
    include: { user: true },
    take: 200,
  });
  for (const row of rows) {
    if (verifySecret(token, row.tokenHash)) {
      await db().accountToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      });
      return row.user;
    }
  }
  throw new Error("ACCOUNT_TOKEN_INVALID_OR_EXPIRED");
}

export async function inviteUser(input: {
  tenantId: string;
  email: string;
  name: string;
  roleKey: string;
  actorId?: string;
}): Promise<{ id: string; invitationToken: string }> {
  const email = input.email.toLowerCase();
  const user = await db().user.upsert({
    where: { email },
    update: { name: input.name, invitedAt: new Date(), deactivatedAt: null },
    create: { email, name: input.name, kind: "USER", invitedAt: new Date() },
  });
  await db().tenantMembership.upsert({
    where: { tenantId_userId: { tenantId: input.tenantId, userId: user.id } },
    update: {},
    create: { tenantId: input.tenantId, userId: user.id },
  });
  await assignUserRole({ ...input, userId: user.id });
  const invitationToken = await issueAccountToken(
    user.id,
    "INVITATION",
    72 * 60 * 60_000,
  );
  await writeAuditEvent({
    tenantId: input.tenantId,
    eventType: "USER_INVITED",
    actorType: "USER",
    actorId: input.actorId,
    subjectType: "USER",
    subjectId: user.id,
    metadata: { email, roleKey: input.roleKey },
  });
  return { id: user.id, invitationToken };
}

export async function acceptInvitation(input: {
  token: string;
  password: string;
}): Promise<void> {
  const user = await consumeAccountToken(input.token, "INVITATION");
  assertPasswordPolicy(input.password, user.email);
  await db().user.update({
    where: { id: user.id },
    data: {
      passwordHash: hashSecret(input.password),
      passwordChangedAt: new Date(),
      acceptedAt: new Date(),
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
    },
  });
}

export async function requestPasswordReset(
  email: string,
): Promise<string | null> {
  const user = await db().user.findUnique({
    where: { email: email.toLowerCase() },
  });
  if (!user || user.archivedAt || user.deactivatedAt) return null;
  return issueAccountToken(user.id, "PASSWORD_RESET", 60 * 60_000);
}

export async function resetPassword(input: {
  token: string;
  password: string;
}): Promise<void> {
  const user = await consumeAccountToken(input.token, "PASSWORD_RESET");
  assertPasswordPolicy(input.password, user.email);
  await db().$transaction([
    db().user.update({
      where: { id: user.id },
      data: {
        passwordHash: hashSecret(input.password),
        passwordChangedAt: new Date(),
        failedLogins: 0,
        lockedUntil: null,
      },
    }),
    db().session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}

export async function issueEmailVerification(userId: string): Promise<string> {
  return issueAccountToken(userId, "EMAIL_VERIFICATION", 24 * 60 * 60_000);
}

export async function verifyEmail(token: string): Promise<void> {
  const user = await consumeAccountToken(token, "EMAIL_VERIFICATION");
  await db().user.update({
    where: { id: user.id },
    data: { emailVerifiedAt: new Date() },
  });
}

export async function issueAccountUnlock(
  email: string,
): Promise<string | null> {
  const user = await db().user.findUnique({
    where: { email: email.toLowerCase() },
  });
  return user
    ? issueAccountToken(user.id, "ACCOUNT_UNLOCK", 30 * 60_000)
    : null;
}

export async function unlockAccount(token: string): Promise<void> {
  const user = await consumeAccountToken(token, "ACCOUNT_UNLOCK");
  await db().user.update({
    where: { id: user.id },
    data: { failedLogins: 0, lockedUntil: null },
  });
}

export async function beginMfaEnrollment(input: {
  tenantId: string;
  userId: string;
}): Promise<{ secret: string; uri: string }> {
  const membership = await db().tenantMembership.findUnique({
    where: { tenantId_userId: input },
    include: { user: true },
  });
  if (!membership) throw new Error("TENANT_MISMATCH");
  const secret = generateTotpSecret();
  await db().user.update({
    where: { id: input.userId },
    data: { mfaSecret: encryptSecret(secret), mfaEnabled: false },
  });
  return { secret, uri: totpUri({ secret, account: membership.user.email }) };
}

export async function confirmMfaEnrollment(input: {
  tenantId: string;
  userId: string;
  code: string;
}): Promise<string[]> {
  const membership = await db().tenantMembership.findUnique({
    where: {
      tenantId_userId: { tenantId: input.tenantId, userId: input.userId },
    },
    include: { user: true },
  });
  if (
    !membership?.user.mfaSecret ||
    !verifyTotp(decryptSecret(membership.user.mfaSecret), input.code)
  )
    throw new Error("MFA_CODE_INVALID");
  const codes = generateRecoveryCodes();
  await db().$transaction([
    db().mfaRecoveryCode.deleteMany({ where: { userId: input.userId } }),
    ...codes.map((code) =>
      db().mfaRecoveryCode.create({
        data: { userId: input.userId, codeHash: hashSecret(code) },
      }),
    ),
    db().user.update({
      where: { id: input.userId },
      data: { mfaEnabled: true },
    }),
  ]);
  return codes;
}

export async function assignUserRole(input: {
  tenantId: string;
  userId: string;
  roleKey: string;
  actorId?: string;
}): Promise<void> {
  const [membership, role] = await Promise.all([
    db().tenantMembership.findUnique({
      where: {
        tenantId_userId: { tenantId: input.tenantId, userId: input.userId },
      },
    }),
    db().role.findUnique({
      where: { tenantId_key: { tenantId: input.tenantId, key: input.roleKey } },
    }),
  ]);
  if (!membership) throw new Error("MEMBERSHIP_NOT_FOUND");
  if (!role) throw new Error("ROLE_NOT_FOUND");
  await db().membershipRole.upsert({
    where: {
      tenantId_userId_roleId: {
        tenantId: input.tenantId,
        userId: input.userId,
        roleId: role.id,
      },
    },
    update: {},
    create: { tenantId: input.tenantId, userId: input.userId, roleId: role.id },
  });
  await writeAuditEvent({
    tenantId: input.tenantId,
    eventType: "USER_ROLE_ASSIGNED",
    actorType: "USER",
    actorId: input.actorId,
    subjectType: "USER",
    subjectId: input.userId,
    metadata: { roleKey: input.roleKey },
  });
}

export async function removeUserRole(input: {
  tenantId: string;
  userId: string;
  roleKey: string;
  actorId?: string;
}): Promise<void> {
  const role = await db().role.findUnique({
    where: { tenantId_key: { tenantId: input.tenantId, key: input.roleKey } },
  });
  if (!role) throw new Error("ROLE_NOT_FOUND");
  await db().membershipRole.deleteMany({
    where: { tenantId: input.tenantId, userId: input.userId, roleId: role.id },
  });
  await writeAuditEvent({
    tenantId: input.tenantId,
    eventType: "USER_ROLE_REMOVED",
    actorType: "USER",
    actorId: input.actorId,
    subjectType: "USER",
    subjectId: input.userId,
    metadata: { roleKey: input.roleKey },
  });
}

export async function grantInstallationAccess(input: {
  tenantId: string;
  userId: string;
  installationId: string;
  actorId?: string;
}): Promise<void> {
  const [membership, installation] = await Promise.all([
    db().tenantMembership.findUnique({
      where: {
        tenantId_userId: { tenantId: input.tenantId, userId: input.userId },
      },
    }),
    db().productInstallation.findFirst({
      where: { id: input.installationId, tenantId: input.tenantId },
    }),
  ]);
  if (!membership) throw new Error("MEMBERSHIP_NOT_FOUND");
  if (!installation) throw new Error("INSTALLATION_TENANT_MISMATCH");
  await db().installationAccess.upsert({
    where: {
      tenantId_userId_installationId: {
        tenantId: input.tenantId,
        userId: input.userId,
        installationId: input.installationId,
      },
    },
    update: {},
    create: {
      tenantId: input.tenantId,
      userId: input.userId,
      installationId: input.installationId,
    },
  });
  await writeAuditEvent({
    tenantId: input.tenantId,
    eventType: "INSTALLATION_ACCESS_GRANTED",
    actorType: "USER",
    actorId: input.actorId,
    subjectType: "USER",
    subjectId: input.userId,
    metadata: { installationId: input.installationId },
  });
}

export async function listTenantRoles(tenantId: string) {
  return db().role.findMany({
    where: { tenantId },
    include: { permissions: { include: { permission: true } } },
  });
}

export async function listTenantUsers(tenantId: string) {
  const memberships = await db().tenantMembership.findMany({
    where: { tenantId },
    include: { user: true, roles: { include: { role: true } } },
    take: 200,
  });
  return memberships.map((membership: any) => ({
    ...membership.user,
    roles: membership.roles,
    tenantId: membership.tenantId,
  }));
}

export async function deactivateUser(input: {
  tenantId: string;
  userId: string;
  actorId: string;
}): Promise<void> {
  const membership = await db().tenantMembership.findUnique({
    where: {
      tenantId_userId: { tenantId: input.tenantId, userId: input.userId },
    },
  });
  if (!membership) throw new Error("MEMBERSHIP_NOT_FOUND");
  await db().$transaction([
    db().user.update({
      where: { id: input.userId },
      data: { deactivatedAt: new Date() },
    }),
    db().session.updateMany({
      where: { userId: input.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
  await writeAuditEvent({
    tenantId: input.tenantId,
    eventType: "USER_DEACTIVATED",
    actorType: "USER",
    actorId: input.actorId,
    subjectType: "USER",
    subjectId: input.userId,
  });
}

export async function listDormantUsers(
  tenantId: string,
  days = Number(process.env.ZOLT_DORMANT_USER_DAYS ?? 90),
) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60_000);
  return db().user.findMany({
    where: {
      memberships: { some: { tenantId } },
      deactivatedAt: null,
      OR: [{ lastActiveAt: null }, { lastActiveAt: { lt: cutoff } }],
    },
    select: {
      id: true,
      email: true,
      name: true,
      lastActiveAt: true,
      lastLoginAt: true,
    },
  });
}
