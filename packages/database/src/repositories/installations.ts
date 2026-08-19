import { prisma } from "../client.js";

export interface IdentityRef {
  tenantKey: string;
  productKey: string;
  installationKey: string;
}

export interface IdentityIds {
  tenantId: string;
  productId: string;
  installationId: string;
}

function db(): any {
  return prisma as unknown as any;
}

export async function resolveInstallationIdentity(
  ref: IdentityRef,
): Promise<IdentityIds> {
  const tenant = await db().tenant.findUnique({ where: { id: ref.tenantKey } });
  if (!tenant || tenant.archivedAt) {
    throw new Error("INSTALLATION_IDENTITY_NOT_FOUND");
  }
  const product = await db().product.findFirst({
    where: { tenantId: tenant.id, externalKey: ref.productKey },
  });
  if (!product) {
    throw new Error("INSTALLATION_IDENTITY_NOT_FOUND");
  }
  const installation = await db().productInstallation.findFirst({
    where: {
      tenantId: tenant.id,
      productId: product.id,
      externalKey: ref.installationKey,
    },
  });
  if (!installation || installation.status === "ARCHIVED") {
    throw new Error("INSTALLATION_IDENTITY_NOT_FOUND");
  }
  if (
    installation.tenantId !== tenant.id ||
    installation.productId !== product.id
  ) {
    throw new Error("TENANT_ISOLATION_VIOLATION");
  }
  return {
    tenantId: tenant.id,
    productId: product.id,
    installationId: installation.id,
  };
}

export async function resolveProductIdentity(input: {
  tenantKey: string;
  productKey: string;
}): Promise<{ tenantId: string; productId: string }> {
  const tenant = await db().tenant.findUnique({
    where: { id: input.tenantKey },
  });
  if (!tenant) {
    throw new Error("INSTALLATION_IDENTITY_NOT_FOUND");
  }
  const product = await db().product.findFirst({
    where: { tenantId: tenant.id, externalKey: input.productKey },
  });
  if (!product) {
    throw new Error("INSTALLATION_IDENTITY_NOT_FOUND");
  }
  return { tenantId: tenant.id, productId: product.id };
}

export async function ensureInstallationIdentity(
  ref: IdentityRef,
): Promise<IdentityIds> {
  try {
    return await resolveInstallationIdentity(ref);
  } catch (error) {
    if (process.env.ZOLT_AUTO_PROVISION_IDENTITIES !== "true") {
      throw error;
    }
  }

  const tenant = await db().tenant.upsert({
    where: { id: ref.tenantKey },
    update: { name: ref.tenantKey },
    create: { id: ref.tenantKey, name: ref.tenantKey },
  });
  const product = await db().product.upsert({
    where: {
      tenantId_externalKey: {
        tenantId: tenant.id,
        externalKey: ref.productKey,
      },
    },
    update: { name: ref.productKey },
    create: {
      tenantId: tenant.id,
      externalKey: ref.productKey,
      key: ref.productKey,
      name: ref.productKey,
      category: "energy",
    },
  });
  const installation = await db().productInstallation.upsert({
    where: {
      tenantId_productId_externalKey: {
        tenantId: tenant.id,
        productId: product.id,
        externalKey: ref.installationKey,
      },
    },
    update: { name: ref.installationKey, status: "ACTIVE" },
    create: {
      tenantId: tenant.id,
      productId: product.id,
      externalKey: ref.installationKey,
      name: ref.installationKey,
    },
  });
  return {
    tenantId: tenant.id,
    productId: product.id,
    installationId: installation.id,
  };
}

export async function assertTenantOwns(
  tenantId: string,
  ids: IdentityIds,
): Promise<void> {
  if (ids.tenantId !== tenantId) {
    throw new Error("TENANT_ISOLATION_VIOLATION");
  }
}

export async function getTelemetryValidationProfile(input: {
  tenantId: string;
  installationId: string;
  assetId?: string;
}): Promise<
  | {
      physicalRanges?: Record<
        string,
        { min: number; max: number; unit?: string }
      >;
    }
  | undefined
> {
  if (!input.assetId) return undefined;
  const asset = await db().asset.findFirst({
    where: {
      tenantId: input.tenantId,
      installationId: input.installationId,
      OR: [{ id: input.assetId }, { externalRef: input.assetId }],
      archivedAt: null,
    },
    select: { operationalLimits: true, validationProfile: true },
  });
  if (!asset) return undefined;
  const validation =
    asset.validationProfile && typeof asset.validationProfile === "object"
      ? asset.validationProfile
      : {};
  const operational =
    asset.operationalLimits && typeof asset.operationalLimits === "object"
      ? asset.operationalLimits
      : {};
  const candidates = {
    ...(operational as Record<string, unknown>),
    ...(((validation as Record<string, unknown>).physicalRanges ??
      {}) as Record<string, unknown>),
  };
  const physicalRanges: Record<
    string,
    { min: number; max: number; unit?: string }
  > = {};
  for (const [key, candidate] of Object.entries(candidates)) {
    if (!candidate || typeof candidate !== "object") continue;
    const range = candidate as Record<string, unknown>;
    if (
      typeof range.min !== "number" ||
      typeof range.max !== "number" ||
      !Number.isFinite(range.min) ||
      !Number.isFinite(range.max) ||
      range.min > range.max
    )
      continue;
    physicalRanges[key] = {
      min: range.min,
      max: range.max,
      ...(typeof range.unit === "string" ? { unit: range.unit } : {}),
    };
  }
  return Object.keys(physicalRanges).length > 0
    ? { physicalRanges }
    : undefined;
}
