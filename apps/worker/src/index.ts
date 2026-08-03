import "dotenv/config";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { telemetryHealthSkill, curtailmentRiskSkill } from "@zolt/capability-energy";
import type { ZoltTelemetryEnvelope } from "@zolt/contracts";
import { AnalysisOrchestrator } from "@zolt/core";
import {
  listTelemetryForInstallation,
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

const orchestrator = new AnalysisOrchestrator([telemetryHealthSkill, curtailmentRiskSkill]);

function webhookTargetForTenant(tenantId: string): { url: string; secret?: string } | null {
  const explicit = process.env.ZOLT_WEBHOOK_TARGETS;
  if (explicit) {
    try {
      const parsed = JSON.parse(explicit) as Record<string, { url?: string; secret?: string }>;
      const target = parsed[tenantId];
      if (target?.url) {
        return { url: target.url, secret: target.secret };
      }
    } catch (error) {
      logError("worker.webhookTargetParse", error);
    }
  }

  if (process.env.ZOLT_WEBHOOK_URL) {
    return {
      url: process.env.ZOLT_WEBHOOK_URL,
      secret: process.env.ZOLT_WEBHOOK_SECRET
    };
  }

  return null;
}

const telemetryWorker = new Worker<ZoltTelemetryEnvelope>(
  TELEMETRY_INGEST_QUEUE,
  async (job) => {
    const envelope = job.data;
    await saveTelemetryEnvelope(envelope);

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
      configuration: {}
    });

    await saveRecommendations(recommendations);

    for (const recommendation of recommendations) {
      await writeAuditEvent({
        tenantId: recommendation.tenantId,
        eventType: "RECOMMENDATION_CREATED",
        actorType: "SYSTEM",
        subjectType: "RECOMMENDATION",
        subjectId: recommendation.id,
        metadata: {
          skillId: recommendation.skillId,
          severity: recommendation.severity
        },
        correlationId: recommendation.id
      });

      const target = webhookTargetForTenant(recommendation.tenantId);
      if (target) {
        await enqueueWebhookDelivery({
          tenantId: recommendation.tenantId,
          eventType: "recommendation.created",
          recommendationId: recommendation.id,
          webhookUrl: target.url,
          webhookSecret: target.secret,
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
    await deliverWebhookPayload(job.data);
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

logInfo("worker.start", { message: "Zolt worker online" });

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
