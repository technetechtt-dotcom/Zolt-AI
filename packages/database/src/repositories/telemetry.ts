import type { ZoltTelemetryEnvelope } from "@zolt/contracts";
import { assessTelemetryQuality, deduplicationKey } from "@zolt/core";
import { prisma } from "../client.js";
import { ensureInstallationIdentity } from "./installations.js";

function db(): any {
  return prisma as unknown as any;
}

export async function saveTelemetryEnvelope(
  envelope: ZoltTelemetryEnvelope,
): Promise<void> {
  const ids = await ensureInstallationIdentity({
    tenantKey: envelope.tenantId,
    productKey: envelope.productId,
    installationKey: envelope.installationId,
  });

  const existingDevice = await db().device.findUnique({
    where: {
      tenantId_installationId_externalRef: {
        tenantId: ids.tenantId,
        installationId: ids.installationId,
        externalRef: envelope.deviceId,
      },
    },
  });

  await db().device.upsert({
    where: {
      tenantId_installationId_externalRef: {
        tenantId: ids.tenantId,
        installationId: ids.installationId,
        externalRef: envelope.deviceId,
      },
    },
    update: {
      lastSeen: new Date(envelope.sourceTimestamp),
      name: envelope.deviceId,
      lastSequence: envelope.sequenceNumber,
      vendor: envelope.vendor,
      model: envelope.model,
      firmwareVersion: envelope.firmwareVersion,
      status: envelope.communicationHealth === "FAILED" ? "OFFLINE" : "ONLINE",
    },
    create: {
      tenantId: ids.tenantId,
      installationId: ids.installationId,
      externalRef: envelope.deviceId,
      name: envelope.deviceId,
      type: "inverter",
      lastSeen: new Date(envelope.sourceTimestamp),
      lastSequence: envelope.sequenceNumber,
      vendor: envelope.vendor,
      model: envelope.model,
      firmwareVersion: envelope.firmwareVersion,
    },
  });

  if (envelope.assetId) {
    await db().asset.upsert({
      where: {
        tenantId_installationId_externalRef: {
          tenantId: ids.tenantId,
          installationId: ids.installationId,
          externalRef: envelope.assetId,
        },
      },
      update: { name: envelope.assetId },
      create: {
        tenantId: ids.tenantId,
        installationId: ids.installationId,
        externalRef: envelope.assetId,
        name: envelope.assetId,
        type: "asset",
      },
    });
  }

  const dedup = deduplicationKey({
    tenantId: envelope.tenantId,
    productId: envelope.productId,
    installationId: envelope.installationId,
    messageId: envelope.messageId,
  });

  const received = new Date(envelope.receivedTimestamp);
  const source = new Date(envelope.sourceTimestamp);
  const delayed = received.getTime() - source.getTime() > 2 * 60_000;
  const stale = received.getTime() - source.getTime() > 15 * 60_000;
  const outOfOrder =
    existingDevice?.lastSequence !== undefined &&
    envelope.sequenceNumber !== undefined &&
    envelope.sequenceNumber < existingDevice.lastSequence;
  const quality = assessTelemetryQuality({ telemetry: [envelope] });

  await db().telemetryMessage.upsert({
    where: {
      tenantId_installationId_messageId: {
        tenantId: ids.tenantId,
        installationId: ids.installationId,
        messageId: envelope.messageId,
      },
    },
    update: {
      sourceTimestamp: source,
      receivedTimestamp: received,
      payload: envelope,
      deduplicationHash: dedup,
      correlationId: envelope.correlationId,
      sequenceNumber: envelope.sequenceNumber,
      delayed,
      stale,
      outOfOrder,
      simulated: envelope.simulated === true,
      schemaVersion: envelope.schemaVersion,
      completenessScore: quality.completenessScore,
      qualityScore: quality.qualityScore,
      clockQualityScore: quality.clockQualityScore,
      sourceTrustLevel: quality.sourceTrustLevel,
      qualityIssues: quality.issues,
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
      sequenceNumber: envelope.sequenceNumber,
      sourceTimestamp: source,
      receivedTimestamp: received,
      payload: envelope,
      delayed,
      stale,
      outOfOrder,
      simulated: envelope.simulated === true,
      schemaVersion: envelope.schemaVersion,
      completenessScore: quality.completenessScore,
      qualityScore: quality.qualityScore,
      clockQualityScore: quality.clockQualityScore,
      sourceTrustLevel: quality.sourceTrustLevel,
      qualityIssues: quality.issues,
    },
  });
}

export async function listTelemetryForInstallation(input: {
  tenantId: string;
  productId: string;
  installationId: string;
  limit?: number;
}): Promise<ZoltTelemetryEnvelope[]> {
  const ids = await ensureInstallationIdentity({
    tenantKey: input.tenantId,
    productKey: input.productId,
    installationKey: input.installationId,
  });

  const rows = await db().telemetryMessage.findMany({
    where: {
      tenantId: ids.tenantId,
      productId: ids.productId,
      installationId: ids.installationId,
      archivedAt: null,
    },
    orderBy: { sourceTimestamp: "desc" },
    take: input.limit ?? 500,
  });

  return rows.map((row: any) => row.payload as ZoltTelemetryEnvelope);
}
