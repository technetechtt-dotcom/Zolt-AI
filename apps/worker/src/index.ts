import "dotenv/config";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { energySkills } from "@zolt/capability-energy";
import type { ZoltTelemetryEnvelope } from "@zolt/contracts";
import { AnalysisOrchestrator } from "@zolt/core";
import {
  listActiveWebhooks,
  listTelemetryForInstallation,
  markWebhookResult,
  recordWebhookDelivery,
  saveRecommendations,
  saveTelemetryEnvelope,
  writeAuditEvent
} from "@zolt/database";
import { logError, logInfo } from "@zolt/observability";
import {
  enqueueDeadLetter,
  enqueueWebhookDelivery,
  TELEMETRY_INGEST_QUEUE,
  WEBHOOK_DELIVERY_QUEUE
} from "@zolt/queue";
import { deliverWebhookPayload } from "./webhook-dispatcher.js";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null
});

const orchestrator = new AnalysisOrchestrator(energySkills);
const MAX_QUEUE_AGE_MS = Number(process.env.ZOLT_MAX_QUEUE_AGE_MS ?? 15 * 60_000);

const telemetryWorker = new Worker<ZoltTelemetryEnvelope>(
  TELEMETRY_INGEST_QUEUE,
  async (job) => {
    if (Date.now() - job.timestamp > MAX_QUEUE_AGE_MS) {
      throw new Error("QUEUE_MESSAGE_TOO_OLD");
    }
    const envelope = job.data;
    try {
      await saveTelemetryEnvelope(envelope);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("INVALID") || message.includes("NOT_FOUND")) {
        await enqueueDeadLetter({
          queue: TELEMETRY_INGEST_QUEUE,
          reason: `poison:${message}`,
          payload: envelope as unknown as Record<string, unknown>
        });
        return;
      }
      throw error;
    }

    const telemetry = await listTelemetryForInstallation({
      tenantId: envelope.tenantId,
      productId: envelope.productId,
      installationId: envelope.installationId
    });

    const recommendations = await orchestrator.analyse({
      tenantId: envelope.tenantId,
      productId: envelope.productId,
      installationId: envelope.installationId,
      telemetry,
      analysisTime: new Date().toISOString(),
      configuration: {},
      correlationId: envelope.correlationId
    });

    await saveRecommendations(recommendations);

    for (const recommendation of recommendations) {
      await writeAuditEvent({
        tenantId: recommendation.tenantId,
        eventType: "RECOMMENDATION_CREATED",
        actorType: "SYSTEM",
        subjectType: "RECOMMENDATION",
        subjectId: recommendation.id,
        metadata: { skillId: recommendation.skillId, severity: recommendation.severity },
        correlationId: envelope.correlationId ?? recommendation.id
      });

      const endpoints = await listActiveWebhooks(recommendation.tenantId, "recommendation.created");
      for (const endpoint of endpoints) {
        await enqueueWebhookDelivery({
          tenantId: recommendation.tenantId,
          eventType: "recommendation.created",
          recommendationId: recommendation.id,
          webhookUrl: endpoint.url,
          webhookSecret: endpoint.secret,
          endpointId: endpoint.id,
          idempotencyId: `${endpoint.id}:${recommendation.id}:created`,
          payload: recommendation as unknown as Record<string, unknown>
        });
      }
    }
  },
  { connection: redis, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5) }
).on("failed", (job, error) => {
  logError("worker.telemetry", error);
  void enqueueDeadLetter({
    queue: TELEMETRY_INGEST_QUEUE,
    reason: error instanceof Error ? error.message : String(error),
    payload: (job?.data ?? {}) as Record<string, unknown>
  });
});

const webhookWorker = new Worker(
  WEBHOOK_DELIVERY_QUEUE,
  async (job) => {
    try {
      await deliverWebhookPayload(job.data);
      if (job.data.endpointId) {
        await recordWebhookDelivery({
          endpointId: job.data.endpointId,
          eventType: job.data.eventType,
          idempotencyId: job.data.idempotencyId ?? job.id ?? job.data.recommendationId,
          payload: job.data.payload,
          status: "delivered"
        });
        await markWebhookResult(job.data.endpointId, true);
      }
    } catch (error) {
      if (job.data.endpointId) {
        await markWebhookResult(job.data.endpointId, false);
      }
      throw error;
    }
  },
  { connection: redis }
).on("failed", (job, error) => {
  logError("worker.webhook", error);
  void enqueueDeadLetter({
    queue: WEBHOOK_DELIVERY_QUEUE,
    reason: error instanceof Error ? error.message : String(error),
    payload: (job?.data ?? {}) as Record<string, unknown>
  });
});

logInfo("worker.start", { message: "Zolt worker online", correlationEnabled: true });

process.on("SIGINT", async () => {
  await telemetryWorker.close();
  await webhookWorker.close();
  await redis.quit();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await telemetryWorker.close();
  await webhookWorker.close();
  await redis.quit();
  process.exit(0);
});
