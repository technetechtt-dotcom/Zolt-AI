import type { ZoltTelemetryEnvelope } from "@zolt/contracts";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const TELEMETRY_INGEST_QUEUE = "telemetry-ingest";
export const WEBHOOK_DELIVERY_QUEUE = "webhook-delivery";
export const DEAD_LETTER_QUEUE = "dead-letter";
export const POISON_QUARANTINE_QUEUE = "poison-quarantine";

export function createRedisConnection(
  url = process.env.REDIS_URL ?? "redis://localhost:6379",
): Redis {
  const redis = new Redis(url, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    connectTimeout: 4_000,
    keepAlive: 10_000,
    retryStrategy: (times) => Math.min(200 + times * 150, 2_000),
    reconnectOnError: (error) => {
      const message = error.message ?? "";
      return (
        message.includes("READONLY") ||
        message.includes("ECONNRESET") ||
        message.includes("ETIMEDOUT") ||
        message.includes("EPIPE")
      );
    },
  });
  redis.on("error", () => undefined);
  return redis;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, code: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(code)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function waitUntilReady(redis: Redis, timeoutMs: number): Promise<void> {
  if (redis.status === "ready") return;
  if (redis.status === "end" || redis.status === "wait" || redis.status === "close") {
    await withTimeout(redis.connect(), timeoutMs, "REDIS_CONNECT_TIMEOUT");
    return;
  }
  await withTimeout(
    new Promise<void>((resolve) => {
      if (redis.status === "ready") {
        resolve();
        return;
      }
      redis.once("ready", () => resolve());
    }),
    timeoutMs,
    "REDIS_READY_TIMEOUT",
  );
}

let connection = createRedisConnection();
let reconnecting: Promise<void> | null = null;

function buildQueues(redis: Redis) {
  return {
    telemetry: new Queue<ZoltTelemetryEnvelope>(TELEMETRY_INGEST_QUEUE, {
      connection: redis,
    }),
    webhook: new Queue<WebhookDeliveryPayload>(WEBHOOK_DELIVERY_QUEUE, {
      connection: redis,
    }),
    deadLetter: new Queue<DeadLetterPayload>(DEAD_LETTER_QUEUE, {
      connection: redis,
    }),
    poison: new Queue<DeadLetterPayload>(POISON_QUARANTINE_QUEUE, {
      connection: redis,
    }),
  };
}

let queues = buildQueues(connection);

export async function reconnectQueue(): Promise<void> {
  if (reconnecting) return reconnecting;
  reconnecting = (async () => {
    const previous = queues;
    const previousConnection = connection;
    try {
      await Promise.allSettled([
        previous.telemetry.close(),
        previous.webhook.close(),
        previous.deadLetter.close(),
        previous.poison.close(),
      ]);
    } catch {
      /* ignore */
    }
    try {
      previousConnection.disconnect();
    } catch {
      /* ignore */
    }
    connection = createRedisConnection();
    queues = buildQueues(connection);
    await waitUntilReady(connection, 8_000);
  })().finally(() => {
    reconnecting = null;
  });
  return reconnecting;
}

export async function pingQueue(
  timeoutMs = 1_500,
  options: { reconnect?: boolean } = {},
): Promise<void> {
  const reconnect = options.reconnect !== false;
  try {
    await waitUntilReady(connection, timeoutMs);
    const result = await withTimeout(
      connection.ping(),
      timeoutMs,
      "REDIS_PING_TIMEOUT",
    );
    if (result !== "PONG") throw new Error("REDIS_UNAVAILABLE");
  } catch (error) {
    if (reconnect) void reconnectQueue().catch(() => undefined);
    throw error instanceof Error ? error : new Error("REDIS_UNAVAILABLE");
  }
}

export function telemetryQueue(): Queue<ZoltTelemetryEnvelope> {
  return queues.telemetry;
}

export function webhookQueue(): Queue<WebhookDeliveryPayload> {
  return queues.webhook;
}

export function deadLetterQueueHandle(): Queue<DeadLetterPayload> {
  return queues.deadLetter;
}

export function poisonQuarantineQueueHandle(): Queue<DeadLetterPayload> {
  return queues.poison;
}

export async function enqueueTelemetry(
  envelope: ZoltTelemetryEnvelope,
): Promise<void> {
  await telemetryQueue().add("ingest", envelope, {
    jobId: `${envelope.tenantId}:${envelope.productId}:${envelope.installationId}:${envelope.messageId}`,
    priority: envelope.communicationHealth === "FAILED" ? 1 : 10,
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: 1000,
    removeOnFail: 1000,
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

export async function enqueueWebhookDelivery(
  payload: WebhookDeliveryPayload,
): Promise<void> {
  await webhookQueue().add("deliver", payload, {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: 1000,
    removeOnFail: 1000,
  });
}

export interface DeadLetterPayload {
  queue: string;
  reason: string;
  payload: Record<string, unknown>;
}

export async function enqueueDeadLetter(
  payload: DeadLetterPayload,
): Promise<void> {
  const queue = payload.reason.startsWith("poison:")
    ? poisonQuarantineQueueHandle()
    : deadLetterQueueHandle();
  await queue.add(
    payload.reason.startsWith("poison:") ? "quarantine" : "dead-letter",
    payload,
    {
      removeOnComplete: 2000,
      removeOnFail: 2000,
    },
  );
}

export async function queueHealth(): Promise<Record<string, unknown>> {
  const queues = [
    telemetryQueue(),
    webhookQueue(),
    deadLetterQueueHandle(),
    poisonQuarantineQueueHandle(),
  ];
  const entries = await Promise.all(
    queues.map(async (queue) => {
      const [counts, oldest] = await Promise.all([
        queue.getJobCounts(),
        queue.getJobs(["waiting", "delayed"], 0, 0, true),
      ]);
      const oldestTimestamp = oldest[0]?.timestamp;
      return [
        queue.name,
        {
          ...counts,
          oldestMessageAgeMs: oldestTimestamp
            ? Math.max(0, Date.now() - oldestTimestamp)
            : 0,
        },
      ];
    }),
  );
  return Object.fromEntries(entries);
}

export async function listDeadLetters(quarantined = false, limit = 100) {
  const queue = quarantined
    ? poisonQuarantineQueueHandle()
    : deadLetterQueueHandle();
  const jobs = await queue.getJobs(
    ["waiting", "delayed", "failed", "completed"],
    0,
    Math.max(0, limit - 1),
    false,
  );
  return jobs.map((job) => ({
    id: job.id,
    name: job.name,
    data: job.data,
    timestamp: job.timestamp,
    failedReason: job.failedReason,
  }));
}

export async function retryDeadLetter(
  jobId: string,
  quarantined = false,
): Promise<void> {
  const source = quarantined
    ? poisonQuarantineQueueHandle()
    : deadLetterQueueHandle();
  const job = await source.getJob(jobId);
  if (!job) throw new Error("DEAD_LETTER_NOT_FOUND");
  if (job.data.queue === TELEMETRY_INGEST_QUEUE)
    await enqueueTelemetry(
      job.data.payload as unknown as ZoltTelemetryEnvelope,
    );
  else if (job.data.queue === WEBHOOK_DELIVERY_QUEUE)
    await enqueueWebhookDelivery(
      job.data.payload as unknown as WebhookDeliveryPayload,
    );
  else throw new Error("DEAD_LETTER_QUEUE_UNKNOWN");
  await job.remove();
}

export async function purgeDeadLetters(quarantined = false): Promise<void> {
  const queue = quarantined
    ? poisonQuarantineQueueHandle()
    : deadLetterQueueHandle();
  await queue.drain(true);
  await Promise.all([
    queue.clean(0, 10_000, "completed"),
    queue.clean(0, 10_000, "failed"),
  ]);
}

export class TenantFairnessGate {
  private readonly active = new Map<string, number>();
  private readonly waiters = new Map<string, Array<() => void>>();

  constructor(
    private readonly maximumPerTenant = Number(
      process.env.ZOLT_WORKER_CONCURRENCY_PER_TENANT ?? 2,
    ),
  ) {}

  async run<T>(tenantId: string, operation: () => Promise<T>): Promise<T> {
    if ((this.active.get(tenantId) ?? 0) >= this.maximumPerTenant) {
      await new Promise<void>((resolve) => {
        const queue = this.waiters.get(tenantId) ?? [];
        queue.push(resolve);
        this.waiters.set(tenantId, queue);
      });
    }
    this.active.set(tenantId, (this.active.get(tenantId) ?? 0) + 1);
    try {
      return await operation();
    } finally {
      const remaining = Math.max(0, (this.active.get(tenantId) ?? 1) - 1);
      if (remaining === 0) this.active.delete(tenantId);
      else this.active.set(tenantId, remaining);
      this.waiters.get(tenantId)?.shift()?.();
    }
  }
}
