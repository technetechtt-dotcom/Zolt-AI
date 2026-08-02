import { prisma } from "../client.js";

export interface IdentityRef {
  tenantKey: string;
  productKey: string;
  installationKey: string;
}

export async function ensureInstallationIdentity(ref: IdentityRef): Promise<{
  tenantId: string;
  productId: string;
  installationId: string;
}> {
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
