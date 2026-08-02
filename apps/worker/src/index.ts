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
import { logError } from "@zolt/observability";
import { enqueueWebhookDelivery, TELEMETRY_INGEST_QUEUE, WEBHOOK_DELIVERY_QUEUE } from "@zolt/queue";
import { deliverWebhookPayload } from "./webhook-dispatcher.js";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null
});

const orchestrator = new AnalysisOrchestrator([telemetryHealthSkill, curtailmentRiskSkill]);

new Worker<ZoltTelemetryEnvelope>(
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

      if (process.env.ZOLT_WEBHOOK_URL) {
        await enqueueWebhookDelivery({
          tenantId: recommendation.tenantId,
          eventType: "recommendation.created",
          recommendationId: recommendation.id,
          webhookUrl: process.env.ZOLT_WEBHOOK_URL,
          payload: recommendation as unknown as Record<string, unknown>
        });
      }
    }
  },
  { connection: redis, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5) }
).on("failed", (_job, error) => {
  logError("worker.telemetry", error);
});

new Worker(
  WEBHOOK_DELIVERY_QUEUE,
  async (job) => {
    await deliverWebhookPayload(job.data);
  },
  { connection: redis }
).on("failed", (_job, error) => {
  logError("worker.webhook", error);
});

console.log("Zolt worker online");

process.on("SIGINT", async () => {
  await redis.quit();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await redis.quit();
  process.exit(0);
});
