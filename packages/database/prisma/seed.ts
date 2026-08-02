import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const tenantId = process.env.ZOLT_SEED_TENANT_ID ?? "tenant-demo";
  const productKey = process.env.ZOLT_SEED_PRODUCT_KEY ?? "product-demo";
  const installationKey = process.env.ZOLT_SEED_INSTALLATION_KEY ?? "installation-demo";

  const tenant = await prisma.tenant.upsert({
    where: { id: tenantId },
    update: { name: tenantId },
    create: { id: tenantId, name: tenantId }
  });

  const product = await prisma.product.upsert({
    where: {
      tenantId_externalKey: {
        tenantId: tenant.id,
        externalKey: productKey
      }
    },
    update: { name: productKey },
    create: {
      tenantId: tenant.id,
      key: productKey,
      externalKey: productKey,
      name: productKey,
      category: "energy"
    }
  });

  await prisma.productInstallation.upsert({
    where: {
      tenantId_productId_externalKey: {
        tenantId: tenant.id,
        productId: product.id,
        externalKey: installationKey
      }
    },
    update: { name: installationKey, status: "ACTIVE" },
    create: {
      tenantId: tenant.id,
      productId: product.id,
      externalKey: installationKey,
      name: installationKey
    }
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log("Seed completed");
  })
  .catch(async (error) => {
    await prisma.$disconnect();
    const message = error instanceof Error ? error.message : String(error);
    console.error("Seed failed:", message);
    process.exit(1);
  });
