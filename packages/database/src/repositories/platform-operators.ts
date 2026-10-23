import { ROLE_PERMISSIONS, type PermissionKey } from "@zolt/contracts";
import { assertPasswordPolicy, hashSecret } from "@zolt/auth";
import { prisma } from "../client.js";
import { writeAuditEvent } from "./audit.js";

function db(): any {
  return prisma as unknown as any;
}

export const PLATFORM_OPERATOR_ROLE = "platform-administrator" as const;
export const DEFAULT_DEVELOPER_EMAIL = "developer@zolt.local";
export const DEFAULT_DEVELOPER_PASSWORD = "ZoltMaintain!24";
export const DEFAULT_DEVELOPER_NAME = "Platform Developer";

export async function userIsPlatformOperator(userId: string): Promise<boolean> {
  const row = await db().membershipRole.findFirst({
    where: { userId, role: { key: PLATFORM_OPERATOR_ROLE } },
  });
  return Boolean(row);
}

export async function ensurePlatformRoleOnTenant(
  tenantId: string,
): Promise<{ id: string }> {
  const role = await db().role.upsert({
    where: { tenantId_key: { tenantId, key: PLATFORM_OPERATOR_ROLE } },
    update: { name: PLATFORM_OPERATOR_ROLE },
    create: {
      tenantId,
      key: PLATFORM_OPERATOR_ROLE,
      name: PLATFORM_OPERATOR_ROLE,
    },
  });
  for (const permissionKey of ROLE_PERMISSIONS[PLATFORM_OPERATOR_ROLE]) {
    const permission = await db().permission.findUnique({
      where: { key: permissionKey },
    });
    if (!permission) continue;
    await db().rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: role.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: { roleId: role.id, permissionId: permission.id },
    });
  }
  return role;
}

export async function grantPlatformOperatorOnTenant(
  tenantId: string,
  userId: string,
): Promise<void> {
  const role = await ensurePlatformRoleOnTenant(tenantId);
  await db().tenantMembership.upsert({
    where: { tenantId_userId: { tenantId, userId } },
    update: {},
    create: { tenantId, userId },
  });
  await db().membershipRole.upsert({
    where: {
      tenantId_userId_roleId: {
        tenantId,
        userId,
        roleId: role.id,
      },
    },
    update: {},
    create: { tenantId, userId, roleId: role.id },
  });
}

export async function grantPlatformOperatorOnAllTenants(
  userId: string,
): Promise<void> {
  const tenants = await db().tenant.findMany({
    where: { archivedAt: null },
    select: { id: true },
  });
  for (const tenant of tenants) {
    await grantPlatformOperatorOnTenant(tenant.id, userId);
  }
}

export async function syncPlatformOperatorsToTenant(
  tenantId: string,
): Promise<void> {
  const operators = await db().membershipRole.findMany({
    where: { role: { key: PLATFORM_OPERATOR_ROLE } },
    select: { userId: true },
  });
  const seen = new Set<string>();
  for (const row of operators) {
    if (seen.has(row.userId)) continue;
    seen.add(row.userId);
    await grantPlatformOperatorOnTenant(tenantId, row.userId);
  }
}

export async function ensurePlatformDeveloperAccount(): Promise<{
  id: string;
  email: string;
} | null> {
  const email = (
    process.env.ZOLT_SEED_DEVELOPER_EMAIL ?? DEFAULT_DEVELOPER_EMAIL
  ).toLowerCase();
  const password =
    process.env.ZOLT_SEED_DEVELOPER_PASSWORD ?? DEFAULT_DEVELOPER_PASSWORD;
  if (process.env.NODE_ENV === "production") {
    if (
      !process.env.ZOLT_SEED_DEVELOPER_EMAIL &&
      !process.env.ZOLT_SEED_DEVELOPER_PASSWORD
    ) {
      return null;
    }
    if (
      !process.env.ZOLT_SEED_DEVELOPER_EMAIL ||
      !process.env.ZOLT_SEED_DEVELOPER_PASSWORD ||
      email === DEFAULT_DEVELOPER_EMAIL ||
      password === DEFAULT_DEVELOPER_PASSWORD
    ) {
      throw new Error("PRODUCTION_SEED_DEVELOPER_CREDENTIALS_REQUIRED");
    }
    assertPasswordPolicy(password, email);
  }

  const existing = await db().user.findUnique({ where: { email } });
  const user = await db().user.upsert({
    where: { email },
    update: {
      name: DEFAULT_DEVELOPER_NAME,
      emailVerifiedAt: existing?.emailVerifiedAt ?? new Date(),
      acceptedAt: existing?.acceptedAt ?? new Date(),
      deactivatedAt: null,
      archivedAt: null,
      ...(existing?.passwordHash
        ? {}
        : {
            passwordHash: hashSecret(password),
            passwordChangedAt: new Date(),
          }),
    },
    create: {
      email,
      name: DEFAULT_DEVELOPER_NAME,
      passwordHash: hashSecret(password),
      kind: "USER",
      emailVerifiedAt: new Date(),
      acceptedAt: new Date(),
      passwordChangedAt: new Date(),
    },
  });
  await grantPlatformOperatorOnAllTenants(user.id);
  const tenant = await db().tenant.findFirst({ where: { archivedAt: null } });
  if (tenant) {
    await writeAuditEvent({
      tenantId: tenant.id,
      eventType: "PLATFORM_DEVELOPER_ENSURED",
      actorType: "SYSTEM",
      actorId: user.id,
      subjectType: "USER",
      subjectId: user.id,
      metadata: { email, roleKey: PLATFORM_OPERATOR_ROLE },
    });
  }
  return { id: user.id, email };
}

export function platformOperatorPermissions(): PermissionKey[] {
  return [...ROLE_PERMISSIONS[PLATFORM_OPERATOR_ROLE]];
}
