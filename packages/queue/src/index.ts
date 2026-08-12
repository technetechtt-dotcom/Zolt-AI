import type { ZoltTelemetryEnvelope } from "@zolt/contracts";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const TELEMETRY_INGEST_QUEUE = "telemetry-ingest";
export const WEBHOOK_DELIVERY_QUEUE = "webhook-delivery";
export const DEAD_LETTER_QUEUE = "dead-letter";

const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null
});

const telemetryIngestQueue = new Queue<ZoltTelemetryEnvelope>(TELEMETRY_INGEST_QUEUE, {
  connection
});
const webhookDeliveryQueue = new Queue<WebhookDeliveryPayload>(WEBHOOK_DELIVERY_QUEUE, {
  connection
});
const deadLetterQueue = new Queue<DeadLetterPayload>(DEAD_LETTER_QUEUE, {
  connection
});

export function telemetryQueue(): Queue<ZoltTelemetryEnvelope> {
  return telemetryIngestQueue;
}

export function webhookQueue(): Queue<WebhookDeliveryPayload> {
  return webhookDeliveryQueue;
}

export function deadLetterQueueHandle(): Queue<DeadLetterPayload> {
  return deadLetterQueue;
}

export async function enqueueTelemetry(envelope: ZoltTelemetryEnvelope): Promise<void> {
  await telemetryQueue().add("ingest", envelope, {
    jobId: `${envelope.tenantId}:${envelope.productId}:${envelope.installationId}:${envelope.messageId}`,
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 2000
    },
    removeOnComplete: 1000,
    removeOnFail: 1000
  });
}

export interface WebhookDeliveryPayload {
  tenantId: string;
  eventType: string;
  recommendationId: string;
  webhookUrl: string;
  webhookSecret?: string;
  endpointId?: string;
  idempotencyId?: string;
  payload: Record<string, unknown>;
}

export async function enqueueWebhookDelivery(payload: WebhookDeliveryPayload): Promise<void> {
  await webhookQueue().add("deliver", payload, {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 2000
    },
    removeOnComplete: 1000,
    removeOnFail: 1000
  });
}

export interface DeadLetterPayload {
  queue: string;
  reason: string;
  payload: Record<string, unknown>;
}

export async function enqueueDeadLetter(payload: DeadLetterPayload): Promise<void> {
  await deadLetterQueueHandle().add("dead-letter", payload, {
    removeOnComplete: 2000,
    removeOnFail: 2000
  });
}
