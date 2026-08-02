import type { ZoltTelemetryEnvelope } from "@zolt/contracts";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const TELEMETRY_INGEST_QUEUE = "telemetry-ingest";
export const WEBHOOK_DELIVERY_QUEUE = "webhook-delivery";

const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null
});

const telemetryIngestQueue = new Queue<ZoltTelemetryEnvelope>(TELEMETRY_INGEST_QUEUE, {
  connection
});
const webhookDeliveryQueue = new Queue<WebhookDeliveryPayload>(WEBHOOK_DELIVERY_QUEUE, {
  connection
});

export function telemetryQueue(): Queue<ZoltTelemetryEnvelope> {
  return telemetryIngestQueue;
}

export function webhookQueue(): Queue<WebhookDeliveryPayload> {
  return webhookDeliveryQueue;
}

export async function enqueueTelemetry(envelope: ZoltTelemetryEnvelope): Promise<void> {
  await telemetryQueue().add("ingest", envelope, {
    jobId: `${envelope.tenantId}:${envelope.productId}:${envelope.installationId}:${envelope.messageId}`,
    removeOnComplete: 1000,
    removeOnFail: 1000
  });
}

export interface WebhookDeliveryPayload {
  tenantId: string;
  eventType: string;
  recommendationId: string;
  webhookUrl: string;
  payload: Record<string, unknown>;
}

export async function enqueueWebhookDelivery(payload: WebhookDeliveryPayload): Promise<void> {
  await webhookQueue().add("deliver", payload, {
    removeOnComplete: 1000,
    removeOnFail: 1000
  });
}
