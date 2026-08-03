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

export interface ProductIdentityIds {
  tenantId: string;
  productId: string;
}

function shouldAutoProvisionIdentity(): boolean {
  return process.env.ZOLT_AUTO_PROVISION_IDENTITIES === "true";
}

async function findIdentity(ref: IdentityRef): Promise<IdentityIds | null> {
  const db = prisma as unknown as any;
  const tenant = await db.tenant.findUnique({
    where: { id: ref.tenantKey }
  });
  if (!tenant) {
    return null;
  }

  const product = await db.product.findFirst({
    where: {
      tenantId: tenant.id,
      externalKey: ref.productKey
    }
  });
  if (!product) {
    return null;
  }

  const installation = await db.productInstallation.findFirst({
    where: {
      tenantId: tenant.id,
      productId: product.id,
      externalKey: ref.installationKey
    }
  });
  if (!installation) {
    return null;
  }

  return {
    tenantId: tenant.id,
    productId: product.id,
    installationId: installation.id
  };
}

export async function resolveInstallationIdentity(ref: IdentityRef): Promise<IdentityIds> {
  const existing = await findIdentity(ref);
  if (!existing) {
    throw new Error("INSTALLATION_IDENTITY_NOT_FOUND");
  }
  return existing;
}

export async function resolveProductIdentity(input: {
  tenantKey: string;
  productKey: string;
}): Promise<ProductIdentityIds> {
  const db = prisma as unknown as any;
  const tenant = await db.tenant.findUnique({
    where: { id: input.tenantKey }
  });
  if (!tenant) {
    throw new Error("INSTALLATION_IDENTITY_NOT_FOUND");
  }

  const product = await db.product.findFirst({
    where: {
      tenantId: tenant.id,
      externalKey: input.productKey
    }
  });
  if (!product) {
    throw new Error("INSTALLATION_IDENTITY_NOT_FOUND");
  }

  return {
    tenantId: tenant.id,
    productId: product.id
  };
}

export async function ensureInstallationIdentity(ref: IdentityRef): Promise<{
  tenantId: string;
  productId: string;
  installationId: string;
}> {
  const existing = await findIdentity(ref);
  if (existing) {
    return existing;
  }

  if (!shouldAutoProvisionIdentity()) {
    throw new Error("INSTALLATION_IDENTITY_NOT_FOUND");
  }

  const db = prisma as unknown as any;

  const tenant = await db.tenant.upsert({
    where: { id: ref.tenantKey },
    update: { name: ref.tenantKey },
    create: { id: ref.tenantKey, name: ref.tenantKey }
  });

  const product = await db.product.upsert({
    where: {
      tenantId_externalKey: {
        tenantId: tenant.id,
        externalKey: ref.productKey
      }
    },
    update: {
      name: ref.productKey
    },
    create: {
      tenantId: tenant.id,
      externalKey: ref.productKey,
      key: ref.productKey,
      name: ref.productKey,
      category: "energy"
    }
  });

  const installation = await db.productInstallation.upsert({
    where: {
      tenantId_productId_externalKey: {
        tenantId: tenant.id,
        productId: product.id,
        externalKey: ref.installationKey
      }
    },
    update: {
      name: ref.installationKey,
      status: "ACTIVE"
    },
    create: {
      tenantId: tenant.id,
      productId: product.id,
      externalKey: ref.installationKey,
      name: ref.installationKey
    }
  });

  return {
    tenantId: tenant.id,
    productId: product.id,
    installationId: installation.id
  };
}
