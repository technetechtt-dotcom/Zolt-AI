import type { ZoltTelemetryEnvelope } from "@zolt/contracts";
import { deduplicationKey } from "@zolt/core";
import { prisma } from "../client.js";
import { ensureInstallationIdentity } from "./installations.js";

export async function saveTelemetryEnvelope(envelope: ZoltTelemetryEnvelope): Promise<void> {
  const db = prisma as unknown as any;
  const ids = await ensureInstallationIdentity({
    tenantKey: envelope.tenantId,
    productKey: envelope.productId,
    installationKey: envelope.installationId
  });

  await db.device.upsert({
    where: {
      tenantId_installationId_externalRef: {
        tenantId: ids.tenantId,
        installationId: ids.installationId,
        externalRef: envelope.deviceId
      }
    },
    update: {
      lastSeen: new Date(envelope.sourceTimestamp),
      name: envelope.deviceId
    },
    create: {
      tenantId: ids.tenantId,
      installationId: ids.installationId,
      externalRef: envelope.deviceId,
      name: envelope.deviceId,
      type: "sensor",
      lastSeen: new Date(envelope.sourceTimestamp)
    }
  });

  if (envelope.assetId) {
    await db.asset.upsert({
      where: {
        tenantId_installationId_externalRef: {
          tenantId: ids.tenantId,
          installationId: ids.installationId,
          externalRef: envelope.assetId
        }
      },
      update: {
        name: envelope.assetId
      },
      create: {
        tenantId: ids.tenantId,
        installationId: ids.installationId,
        externalRef: envelope.assetId,
        name: envelope.assetId,
        type: "asset"
      }
    });
  }

  const dedup = deduplicationKey({
    tenantId: envelope.tenantId,
    productId: envelope.productId,
    installationId: envelope.installationId,
    messageId: envelope.messageId
  });

  await db.telemetryMessage.upsert({
    where: {
      tenantId_installationId_messageId: {
        tenantId: ids.tenantId,
        installationId: ids.installationId,
        messageId: envelope.messageId
      }
    },
    update: {
      sourceTimestamp: new Date(envelope.sourceTimestamp),
      receivedTimestamp: new Date(envelope.receivedTimestamp),
      payload: envelope,
      deduplicationHash: dedup,
      correlationId: envelope.correlationId
    },
    create: {
      tenantId: ids.tenantId,
      productId: ids.productId,
      installationId: ids.installationId,
      messageId: envelope.messageId,
      deduplicationHash: dedup,
      correlationId: envelope.correlationId,
      deviceId: envelope.deviceId,
      assetId: envelope.assetId,
      sourceTimestamp: new Date(envelope.sourceTimestamp),
      receivedTimestamp: new Date(envelope.receivedTimestamp),
      payload: envelope
    }
  });
}

export async function listTelemetryForInstallation(input: {
  tenantId: string;
  productId: string;
  installationId: string;
  limit?: number;
}): Promise<ZoltTelemetryEnvelope[]> {
  const db = prisma as unknown as any;
  const ids = await ensureInstallationIdentity({
    tenantKey: input.tenantId,
    productKey: input.productId,
    installationKey: input.installationId
  });

  const rows = await db.telemetryMessage.findMany({
    where: {
      tenantId: ids.tenantId,
      productId: ids.productId,
      installationId: ids.installationId
    },
    orderBy: {
      sourceTimestamp: "desc"
    },
    take: input.limit ?? 500
  });

  return rows.map((row: any) => row.payload as ZoltTelemetryEnvelope);
}
