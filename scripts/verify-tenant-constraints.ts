import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const db = prisma as unknown as any;
const runId = `constraint-${Date.now()}`;

async function mustReject(
  label: string,
  operation: () => Promise<unknown>,
): Promise<void> {
  try {
    await operation();
  } catch {
    process.stdout.write(`PASS ${label}\n`);
    return;
  }
  throw new Error(`DATABASE_CONSTRAINT_MISSING:${label}`);
}

async function main(): Promise<void> {
  const tenantA = await db.tenant.create({
    data: { id: `${runId}-a`, name: "Constraint tenant A" },
  });
  const tenantB = await db.tenant.create({
    data: { id: `${runId}-b`, name: "Constraint tenant B" },
  });
  const productA = await db.product.create({
    data: {
      tenantId: tenantA.id,
      key: "p",
      externalKey: "p",
      name: "A",
      category: "energy",
    },
  });
  const productB = await db.product.create({
    data: {
      tenantId: tenantB.id,
      key: "p",
      externalKey: "p",
      name: "B",
      category: "energy",
    },
  });
  const installationA = await db.productInstallation.create({
    data: {
      tenantId: tenantA.id,
      productId: productA.id,
      externalKey: "i",
      name: "A",
    },
  });
  const installationB = await db.productInstallation.create({
    data: {
      tenantId: tenantB.id,
      productId: productB.id,
      externalKey: "i",
      name: "B",
    },
  });
  const user = await db.user.create({
    data: { email: `${runId}@zolt.invalid`, name: "Multi-tenant user" },
  });
  await db.tenantMembership.createMany({
    data: [
      { tenantId: tenantA.id, userId: user.id },
      { tenantId: tenantB.id, userId: user.id },
    ],
  });
  const adminA = await db.role.create({
    data: { tenantId: tenantA.id, key: "tenant-administrator", name: "Admin" },
  });
  const analystB = await db.role.create({
    data: { tenantId: tenantB.id, key: "analyst", name: "Analyst" },
  });

  await db.membershipRole.create({
    data: { tenantId: tenantA.id, userId: user.id, roleId: adminA.id },
  });
  await db.membershipRole.create({
    data: { tenantId: tenantB.id, userId: user.id, roleId: analystB.id },
  });
  process.stdout.write(
    "PASS one user has different roles in different tenants\n",
  );

  await mustReject("cross-tenant membership role", () =>
    db.membershipRole.create({
      data: { tenantId: tenantB.id, userId: user.id, roleId: adminA.id },
    }),
  );
  await mustReject("cross-tenant installation access", () =>
    db.installationAccess.create({
      data: {
        tenantId: tenantA.id,
        userId: user.id,
        installationId: installationB.id,
      },
    }),
  );
  await mustReject("credential product tenant mismatch", () =>
    db.apiCredential.create({
      data: {
        tenantId: tenantA.id,
        productId: productB.id,
        name: "bad-product",
        keyPrefix: "bad-product",
        keyHash: "x:y",
        signingSecretEnc: "x:y:z",
        permissions: [],
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    }),
  );
  await mustReject("credential installation tenant mismatch", () =>
    db.apiCredential.create({
      data: {
        tenantId: tenantA.id,
        productId: productB.id,
        installationId: installationB.id,
        name: "bad-installation",
        keyPrefix: "bad-install",
        keyHash: "x:y",
        signingSecretEnc: "x:y:z",
        permissions: [],
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    }),
  );
  await mustReject("telemetry installation product mismatch", () =>
    db.telemetryMessage.create({
      data: {
        tenantId: tenantA.id,
        productId: productB.id,
        installationId: installationA.id,
        messageId: "cross-tenant-message",
        deduplicationHash: "cross-tenant-hash",
        deviceId: "device",
        sourceTimestamp: new Date(),
        receivedTimestamp: new Date(),
        payload: {},
      },
    }),
  );
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    await prisma.$disconnect();
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exit(1);
  });
