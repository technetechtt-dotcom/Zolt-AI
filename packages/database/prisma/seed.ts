import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { encryptSecret, generateSigningSecret, hashSecret } from "@zolt/auth";
import { PermissionKey, ROLE_PERMISSIONS, RoleKey } from "@zolt/contracts";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const tenantId = process.env.ZOLT_SEED_TENANT_ID ?? "tenant-demo";
  const productKey = process.env.ZOLT_SEED_PRODUCT_KEY ?? "product-demo";
  const installationKey = process.env.ZOLT_SEED_INSTALLATION_KEY ?? "installation-demo";
  const db = prisma as unknown as any;

  const tenant = await db.tenant.upsert({
    where: { id: tenantId },
    update: { name: tenantId },
    create: { id: tenantId, name: tenantId, plan: "pilot" }
  });

  const product = await db.product.upsert({
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

  const installation = await db.productInstallation.upsert({
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

  for (const key of PermissionKey.options) {
    await db.permission.upsert({
      where: { key },
      update: {},
      create: { key }
    });
  }

  for (const key of RoleKey.options) {
    const role = await db.role.upsert({
      where: { key },
      update: { name: key },
      create: { key, name: key }
    });
    const permissions = ROLE_PERMISSIONS[key as RoleKey];
    for (const permissionKey of permissions) {
      const permission = await db.permission.findUnique({ where: { key: permissionKey } });
      if (!permission) {
        continue;
      }
      await db.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permission.id
          }
        },
        update: {},
        create: { roleId: role.id, permissionId: permission.id }
      });
    }
  }

  const adminRole = await db.role.findUnique({ where: { key: "tenant-administrator" } });
  const email = process.env.ZOLT_SEED_ADMIN_EMAIL ?? "admin@zolt.local";
  const password = process.env.ZOLT_SEED_ADMIN_PASSWORD ?? "ChangeMeNow!23";
  const user = await db.user.upsert({
    where: { email },
    update: { name: "Seed Administrator", tenantId: tenant.id },
    create: {
      email,
      name: "Seed Administrator",
      passwordHash: hashSecret(password),
      kind: "USER",
      tenantId: tenant.id
    }
  });
  await db.tenantMembership.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
    update: {},
    create: { tenantId: tenant.id, userId: user.id }
  });
  if (adminRole) {
    await db.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
      update: {},
      create: { userId: user.id, roleId: adminRole.id }
    });
  }

  const apiKey = process.env.ZOLT_API_KEY;
  const signingSecret = process.env.ZOLT_INGEST_HMAC_SECRET ?? generateSigningSecret();
  if (apiKey) {
    const existing = await db.apiCredential.findFirst({
      where: { tenantId: tenant.id, name: "seed-bootstrap" }
    });
    if (!existing) {
      await db.apiCredential.create({
        data: {
          tenantId: tenant.id,
          productId: product.id,
          installationId: installation.id,
          name: "seed-bootstrap",
          keyPrefix: apiKey.slice(0, 12),
          keyHash: hashSecret(apiKey),
          signingSecretEnc: encryptSecret(signingSecret),
          permissions: ROLE_PERMISSIONS["api-integration"]
        }
      });
    }
  }

  const webhookUrl = process.env.ZOLT_WEBHOOK_URL;
  if (webhookUrl) {
    const existingWebhook = await db.webhookEndpoint.findFirst({
      where: { tenantId: tenant.id, url: webhookUrl }
    });
    if (!existingWebhook) {
      await db.webhookEndpoint.create({
        data: {
          tenantId: tenant.id,
          url: webhookUrl,
          secretEnc: encryptSecret(process.env.ZOLT_WEBHOOK_SECRET ?? generateSigningSecret()),
          events: ["recommendation.created"]
        }
      });
    }
  }
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
