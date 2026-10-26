import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import {
  encryptSecret,
  generateApiKey,
  generateSigningSecret,
  hashSecret,
} from "@zolt/auth";
import { createApiCredential } from "../packages/database/src/repositories/credentials.js";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const tenantId = process.env.ZOLT_LOAD_TENANT_ID ?? "tenant-demo";
  const productKey = process.env.ZOLT_LOAD_PRODUCT_ID ?? "product-demo";
  const installationKey =
    process.env.ZOLT_LOAD_INSTALLATION_ID ?? "installation-demo";
  const db = prisma as unknown as any;
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error("SOAK_TENANT_NOT_FOUND");
  const product = await db.product.findFirst({
    where: { tenantId: tenant.id, externalKey: productKey },
  });
  if (!product) throw new Error("SOAK_PRODUCT_NOT_FOUND");
  const installation = await db.productInstallation.findFirst({
    where: {
      tenantId: tenant.id,
      productId: product.id,
      externalKey: installationKey,
    },
  });
  if (!installation) throw new Error("SOAK_INSTALLATION_NOT_FOUND");

  await db.apiCredential.updateMany({
    where: { tenantId: tenant.id, name: "soak-load", status: "ACTIVE" },
    data: { status: "REVOKED", revokedAt: new Date() },
  });

  const key = generateApiKey();
  const signingSecret = generateSigningSecret();
  const id = await createApiCredential({
    tenantId: tenant.id,
    name: "soak-load",
    productId: product.id,
    installationId: installation.id,
    permissions: ["telemetry:write", "telemetry:read"],
    plaintextKey: key.plaintext,
    prefix: key.prefix,
    signingSecret,
    keyHash: hashSecret(key.plaintext),
    signingSecretEnc: encryptSecret(signingSecret),
    kind: "SERVICE_ACCOUNT",
  });

  const record = {
    generatedAt: new Date().toISOString(),
    credentialId: id,
    name: "soak-load",
    tenantId,
    productId: productKey,
    installationId: installationKey,
    permissions: ["telemetry:write", "telemetry:read"],
    apiKey: key.plaintext,
    hmacSecret: signingSecret,
  };
  await mkdir("ops/load", { recursive: true });
  await writeFile(
    "ops/load/credential.json",
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(
    `${JSON.stringify({ ...record, apiKey: `${key.prefix}…`, hmacSecret: "stored" }, null, 2)}\n`,
  );
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
