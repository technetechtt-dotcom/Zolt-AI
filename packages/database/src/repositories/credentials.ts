import type { PermissionKey } from "@zolt/contracts";
import { ROLE_PERMISSIONS } from "@zolt/contracts";
import type { AuthenticatedPrincipal } from "@zolt/auth";
import { decryptSecret, verifySecret } from "@zolt/auth";
import { prisma } from "../client.js";
import { writeAuditEvent } from "./audit.js";
import { resolveProductIdentity } from "./installations.js";

function db(): any {
  return prisma as unknown as any;
}

const HIGH_RISK_PERMISSIONS = new Set<PermissionKey>([
  "admin:manage",
  "integration:manage",
  "webhook:manage",
]);

export function credentialExpiryPolicy(): {
  minimumDays: number;
  defaultDays: number;
  maximumDays: number;
  warningDays: number;
} {
  const minimumDays = Number(process.env.ZOLT_CREDENTIAL_MIN_EXPIRY_DAYS ?? 1);
  const defaultDays = Number(
    process.env.ZOLT_CREDENTIAL_DEFAULT_EXPIRY_DAYS ?? 90,
  );
  const maximumDays = Number(
    process.env.ZOLT_CREDENTIAL_MAX_EXPIRY_DAYS ?? 365,
  );
  const warningDays = Number(process.env.ZOLT_CREDENTIAL_WARNING_DAYS ?? 14);
  if (
    minimumDays <= 0 ||
    defaultDays < minimumDays ||
    maximumDays < defaultDays
  ) {
    throw new Error("CREDENTIAL_EXPIRY_POLICY_INVALID");
  }
  return { minimumDays, defaultDays, maximumDays, warningDays };
}

export function credentialExpiryFromDays(days?: number): Date {
  const policy = credentialExpiryPolicy();
  const requested = days ?? policy.defaultDays;
  if (
    !Number.isInteger(requested) ||
    requested < policy.minimumDays ||
    requested > policy.maximumDays
  ) {
    throw new Error(
      `CREDENTIAL_EXPIRY_OUT_OF_POLICY:${policy.minimumDays}-${policy.maximumDays}`,
    );
  }
  return new Date(Date.now() + requested * 24 * 60 * 60_000);
}

export async function resolveApiCredential(
  plaintext: string,
): Promise<AuthenticatedPrincipal | null> {
  const prefix = plaintext.slice(0, 12);
  const rows = await db().apiCredential.findMany({
    where: {
      keyPrefix: prefix,
      status: "ACTIVE",
      tenant: { archivedAt: null },
    },
    include: { product: true, installation: true },
    take: 20,
  });

  for (const row of rows) {
    if (!verifySecret(plaintext, row.keyHash)) {
      continue;
    }
    if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
      await db().apiCredential.update({
        where: { id: row.id },
        data: { status: "EXPIRED" },
      });
      continue;
    }
    if (row.revokedAt) {
      continue;
    }

    await db().apiCredential.update({
      where: { id: row.id },
      data: { lastUsedAt: new Date() },
    });
    await writeAuditEvent({
      tenantId: row.tenantId,
      eventType: "CREDENTIAL_USED",
      actorType: "API",
      actorId: row.id,
      subjectType: "API_CREDENTIAL",
      subjectId: row.id,
    });

    const permissions =
      (row.permissions as PermissionKey[]) ??
      ROLE_PERMISSIONS["api-integration"];
    return {
      tenantId: row.tenantId,
      productId: row.product?.externalKey ?? undefined,
      installationId: row.installation?.externalKey ?? undefined,
      credentialId: row.id,
      userId: row.userId ?? undefined,
      permissions,
      signingSecret: decryptSecret(row.signingSecretEnc),
      actorType: "API",
    };
  }

  return null;
}

export async function createApiCredential(input: {
  tenantId: string;
  name: string;
  productId?: string;
  installationId?: string;
  permissions: PermissionKey[];
  plaintextKey: string;
  prefix: string;
  signingSecret: string;
  keyHash: string;
  signingSecretEnc: string;
  expiresAt?: Date;
  kind?: "API_INTEGRATION" | "SERVICE_ACCOUNT" | "DEVICE";
  userId?: string;
}): Promise<string> {
  if (input.productId) {
    const product = await resolveProductIdentity({
      tenantKey: input.tenantId,
      productKey: input.productId,
    }).catch(async () => {
      const row = await db().product.findFirst({
        where: { id: input.productId, tenantId: input.tenantId },
      });
      if (!row) {
        throw new Error("CREDENTIAL_PRODUCT_TENANT_MISMATCH");
      }
      return { tenantId: row.tenantId, productId: row.id };
    });
    input.productId = product.productId;
  }
  if (input.installationId) {
    const installation = await db().productInstallation.findFirst({
      where: { id: input.installationId, tenantId: input.tenantId },
    });
    if (!installation) {
      throw new Error("CREDENTIAL_INSTALLATION_TENANT_MISMATCH");
    }
    if (input.productId && installation.productId !== input.productId) {
      throw new Error("CREDENTIAL_INSTALLATION_PRODUCT_MISMATCH");
    }
    input.productId = installation.productId;
  }
  if (input.userId) {
    const membership = await db().tenantMembership.findUnique({
      where: {
        tenantId_userId: { tenantId: input.tenantId, userId: input.userId },
      },
    });
    if (!membership) throw new Error("CREDENTIAL_USER_TENANT_MISMATCH");
  }
  const highRisk = input.permissions.some((permission) =>
    HIGH_RISK_PERMISSIONS.has(permission),
  );
  const created = await db().apiCredential.create({
    data: {
      tenantId: input.tenantId,
      productId: input.productId,
      installationId: input.installationId,
      userId: input.userId,
      name: input.name,
      keyPrefix: input.prefix,
      keyHash: input.keyHash,
      signingSecretEnc: input.signingSecretEnc,
      permissions: input.permissions,
      kind: input.kind ?? "API_INTEGRATION",
      status: highRisk ? "PENDING_APPROVAL" : "ACTIVE",
      expiresAt: input.expiresAt ?? credentialExpiryFromDays(),
    },
  });
  await writeAuditEvent({
    tenantId: input.tenantId,
    eventType: "CREDENTIAL_CREATED",
    actorType: "SYSTEM",
    subjectType: "API_CREDENTIAL",
    subjectId: created.id,
    metadata: { highRisk, kind: input.kind ?? "API_INTEGRATION" },
  });
  return created.id;
}

export async function listApiCredentials(tenantId: string) {
  const rows = await db().apiCredential.findMany({
    where: { tenantId },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      permissions: true,
      kind: true,
      status: true,
      approvedAt: true,
      expiresAt: true,
      lastUsedAt: true,
      createdAt: true,
      productId: true,
      installationId: true,
    },
    orderBy: { createdAt: "desc" },
  });
  const warningAt =
    Date.now() + credentialExpiryPolicy().warningDays * 24 * 60 * 60_000;
  return rows.map((row: any) => ({
    ...row,
    expiryWarning: Boolean(
      row.expiresAt &&
      new Date(row.expiresAt).getTime() <= warningAt &&
      row.status === "ACTIVE",
    ),
  }));
}

export async function approveApiCredential(input: {
  tenantId: string;
  credentialId: string;
  actorId: string;
}): Promise<void> {
  const credential = await db().apiCredential.findFirst({
    where: {
      id: input.credentialId,
      tenantId: input.tenantId,
      status: "PENDING_APPROVAL",
    },
  });
  if (!credential) throw new Error("CREDENTIAL_NOT_FOUND_OR_NOT_PENDING");
  await db().apiCredential.update({
    where: { id: credential.id },
    data: {
      status: "ACTIVE",
      approvedAt: new Date(),
      approvedById: input.actorId,
    },
  });
  await writeAuditEvent({
    tenantId: input.tenantId,
    eventType: "CREDENTIAL_APPROVED",
    actorType: "USER",
    actorId: input.actorId,
    subjectType: "API_CREDENTIAL",
    subjectId: credential.id,
  });
}

export async function revokeCredentialsForIdentity(input: {
  tenantId: string;
  userId?: string;
  kind?: "API_INTEGRATION" | "SERVICE_ACCOUNT" | "DEVICE";
  actorId?: string;
}): Promise<number> {
  if (!input.userId && !input.kind)
    throw new Error("CREDENTIAL_REVOCATION_SCOPE_REQUIRED");
  const result = await db().apiCredential.updateMany({
    where: {
      tenantId: input.tenantId,
      userId: input.userId,
      kind: input.kind,
      status: { in: ["ACTIVE", "PENDING_APPROVAL"] },
    },
    data: { status: "REVOKED", revokedAt: new Date() },
  });
  await writeAuditEvent({
    tenantId: input.tenantId,
    eventType: "CREDENTIALS_EMERGENCY_REVOKED",
    actorType: "USER",
    actorId: input.actorId,
    subjectType: input.kind ?? "IDENTITY",
    subjectId: input.userId ?? input.kind!,
    metadata: { count: result.count },
  });
  return result.count;
}

export async function revokeApiCredential(
  tenantId: string,
  credentialId: string,
  actorId?: string,
): Promise<void> {
  const existing = await db().apiCredential.findFirst({
    where: { id: credentialId, tenantId },
  });
  if (!existing) {
    throw new Error("CREDENTIAL_NOT_FOUND");
  }
  await db().apiCredential.update({
    where: { id: credentialId },
    data: { status: "REVOKED", revokedAt: new Date() },
  });
  await writeAuditEvent({
    tenantId,
    eventType: "CREDENTIAL_REVOKED",
    actorType: "USER",
    actorId,
    subjectType: "API_CREDENTIAL",
    subjectId: credentialId,
  });
}

export async function rotateApiCredential(input: {
  tenantId: string;
  credentialId: string;
  plaintextKey: string;
  prefix: string;
  keyHash: string;
  signingSecretEnc: string;
  actorId?: string;
}): Promise<void> {
  const existing = await db().apiCredential.findFirst({
    where: { id: input.credentialId, tenantId: input.tenantId },
  });
  if (!existing) {
    throw new Error("CREDENTIAL_NOT_FOUND");
  }
  await db().apiCredential.update({
    where: { id: existing.id },
    data: { status: "ROTATED", revokedAt: new Date() },
  });
  await db().apiCredential.create({
    data: {
      tenantId: existing.tenantId,
      productId: existing.productId,
      installationId: existing.installationId,
      userId: existing.userId,
      name: existing.name,
      keyPrefix: input.prefix,
      keyHash: input.keyHash,
      signingSecretEnc: input.signingSecretEnc,
      permissions: existing.permissions,
      kind: existing.kind,
      status: "ACTIVE",
      approvedAt: existing.approvedAt,
      approvedById: existing.approvedById,
      expiresAt: credentialExpiryFromDays(),
      rotatedFromId: existing.id,
    },
  });
  await writeAuditEvent({
    tenantId: input.tenantId,
    eventType: "CREDENTIAL_ROTATED",
    actorType: "USER",
    actorId: input.actorId,
    subjectType: "API_CREDENTIAL",
    subjectId: existing.id,
  });
}
