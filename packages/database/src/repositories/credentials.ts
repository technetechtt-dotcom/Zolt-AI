import type { PermissionKey } from "@zolt/contracts";
import { ROLE_PERMISSIONS } from "@zolt/contracts";
import type { AuthenticatedPrincipal } from "@zolt/auth";
import { decryptSecret, verifySecret } from "@zolt/auth";
import { prisma } from "../client.js";
import { writeAuditEvent } from "./audit.js";

function db(): any {
  return prisma as unknown as any;
}

export async function resolveApiCredential(plaintext: string): Promise<AuthenticatedPrincipal | null> {
  const prefix = plaintext.slice(0, 12);
  const rows = await db().apiCredential.findMany({
    where: { keyPrefix: prefix, status: "ACTIVE" },
    include: { product: true, installation: true },
    take: 20
  });

  for (const row of rows) {
    if (!verifySecret(plaintext, row.keyHash)) {
      continue;
    }
    if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
      await db().apiCredential.update({ where: { id: row.id }, data: { status: "EXPIRED" } });
      continue;
    }
    if (row.revokedAt) {
      continue;
    }

    await db().apiCredential.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
    await writeAuditEvent({
      tenantId: row.tenantId,
      eventType: "CREDENTIAL_USED",
      actorType: "API",
      actorId: row.id,
      subjectType: "API_CREDENTIAL",
      subjectId: row.id
    });

    const permissions = (row.permissions as PermissionKey[]) ?? ROLE_PERMISSIONS["api-integration"];
    return {
      tenantId: row.tenantId,
      productId: row.product?.externalKey ?? undefined,
      installationId: row.installation?.externalKey ?? undefined,
      credentialId: row.id,
      userId: row.userId ?? undefined,
      permissions,
      signingSecret: decryptSecret(row.signingSecretEnc),
      actorType: "API"
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
}): Promise<string> {
  const created = await db().apiCredential.create({
    data: {
      tenantId: input.tenantId,
      productId: input.productId,
      installationId: input.installationId,
      name: input.name,
      keyPrefix: input.prefix,
      keyHash: input.keyHash,
      signingSecretEnc: input.signingSecretEnc,
      permissions: input.permissions,
      expiresAt: input.expiresAt
    }
  });
  await writeAuditEvent({
    tenantId: input.tenantId,
    eventType: "CREDENTIAL_CREATED",
    actorType: "SYSTEM",
    subjectType: "API_CREDENTIAL",
    subjectId: created.id
  });
  return created.id;
}

export async function listApiCredentials(tenantId: string) {
  return db().apiCredential.findMany({
    where: { tenantId },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      permissions: true,
      status: true,
      expiresAt: true,
      lastUsedAt: true,
      createdAt: true,
      productId: true,
      installationId: true
    },
    orderBy: { createdAt: "desc" }
  });
}

export async function revokeApiCredential(tenantId: string, credentialId: string, actorId?: string): Promise<void> {
  const existing = await db().apiCredential.findFirst({ where: { id: credentialId, tenantId } });
  if (!existing) {
    throw new Error("CREDENTIAL_NOT_FOUND");
  }
  await db().apiCredential.update({
    where: { id: credentialId },
    data: { status: "REVOKED", revokedAt: new Date() }
  });
  await writeAuditEvent({
    tenantId,
    eventType: "CREDENTIAL_REVOKED",
    actorType: "USER",
    actorId,
    subjectType: "API_CREDENTIAL",
    subjectId: credentialId
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
  const existing = await db().apiCredential.findFirst({ where: { id: input.credentialId, tenantId: input.tenantId } });
  if (!existing) {
    throw new Error("CREDENTIAL_NOT_FOUND");
  }
  await db().apiCredential.update({
    where: { id: existing.id },
    data: { status: "ROTATED", revokedAt: new Date() }
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
      expiresAt: existing.expiresAt,
      rotatedFromId: existing.id
    }
  });
  await writeAuditEvent({
    tenantId: input.tenantId,
    eventType: "CREDENTIAL_ROTATED",
    actorType: "USER",
    actorId: input.actorId,
    subjectType: "API_CREDENTIAL",
    subjectId: existing.id
  });
}
