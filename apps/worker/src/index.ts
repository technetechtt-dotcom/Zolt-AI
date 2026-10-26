import "dotenv/config";
import { createServer } from "node:http";
import { Worker } from "bullmq";
import { energySkills } from "@zolt/capability-energy";
import type { ZoltTelemetryEnvelope } from "@zolt/contracts";
import { AnalysisOrchestrator } from "@zolt/core";
import {
  listActiveWebhooks,
  listTelemetryForInstallation,
  markWebhookResult,
  pingDatabase,
  recordWebhookDelivery,
  runRetentionJobs,
  saveRecommendations,
  saveTelemetryEnvelope,
  writeAuditEvent,
} from "@zolt/database";
import { logError, logInfo, metrics } from "@zolt/observability";
import {
  createRedisConnection,
  enqueueDeadLetter,
  enqueueWebhookDelivery,
  TenantFairnessGate,
  TELEMETRY_INGEST_QUEUE,
  WEBHOOK_DELIVERY_QUEUE,
} from "@zolt/queue";
import { deliverWebhookPayload } from "./webhook-dispatcher.js";
import { assertProductionConfiguration } from "@zolt/auth";

assertProductionConfiguration("worker");

const redis = createRedisConnection();

const orchestrator = new AnalysisOrchestrator(energySkills);
const MAX_QUEUE_AGE_MS = Number(
  process.env.ZOLT_MAX_QUEUE_AGE_MS ?? 15 * 60_000,
);
const tenantFairness = new TenantFairnessGate();

const telemetryWorker = new Worker<ZoltTelemetryEnvelope>(
  TELEMETRY_INGEST_QUEUE,
  async (job) =>
    tenantFairness.run(job.data.tenantId, async () => {
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
            payload: envelope as unknown as Record<string, unknown>,
          });
          return;
        }
        throw error;
      }

      const telemetry = await listTelemetryForInstallation({
        tenantId: envelope.tenantId,
        productId: envelope.productId,
        installationId: envelope.installationId,
      });

      const recommendations = await orchestrator.analyse({
        tenantId: envelope.tenantId,
        productId: envelope.productId,
        installationId: envelope.installationId,
        telemetry,
        analysisTime: new Date().toISOString(),
        configuration: {},
        correlationId: envelope.correlationId,
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
            severity: recommendation.severity,
          },
          correlationId: envelope.correlationId ?? recommendation.id,
        });

        const endpoints = await listActiveWebhooks(
          recommendation.tenantId,
          "recommendation.created",
        );
        for (const endpoint of endpoints) {
          await enqueueWebhookDelivery({
            tenantId: recommendation.tenantId,
            eventType: "recommendation.created",
            recommendationId: recommendation.id,
            webhookUrl: endpoint.url,
            webhookSecret: endpoint.secret,
            endpointId: endpoint.id,
            idempotencyId: `${endpoint.id}:${recommendation.id}:created`,
            payload: recommendation as unknown as Record<string, unknown>,
          });
        }
      }
    }),
  {
    connection: redis,
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5),
  },
).on("failed", (job, error) => {
  metrics.increment("zolt_worker_jobs_total", {
    queue: TELEMETRY_INGEST_QUEUE,
    status: "failed",
  });
  logError("worker.telemetry", error);
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    void enqueueDeadLetter({
      queue: TELEMETRY_INGEST_QUEUE,
      reason: error instanceof Error ? error.message : String(error),
      payload: (job.data ?? {}) as Record<string, unknown>,
    });
  }
});

const webhookWorker = new Worker(
  WEBHOOK_DELIVERY_QUEUE,
  async (job) =>
    tenantFairness.run(job.data.tenantId, async () => {
      try {
        await deliverWebhookPayload(job.data);
        if (job.data.endpointId) {
          await recordWebhookDelivery({
            endpointId: job.data.endpointId,
            eventType: job.data.eventType,
            idempotencyId:
              job.data.idempotencyId ?? job.id ?? job.data.recommendationId,
            payload: job.data.payload,
            status: "delivered",
          });
          await markWebhookResult(job.data.endpointId, true);
        }
      } catch (error) {
        if (job.data.endpointId) {
          await recordWebhookDelivery({
            endpointId: job.data.endpointId,
            eventType: job.data.eventType,
            idempotencyId:
              job.data.idempotencyId ?? job.id ?? job.data.recommendationId,
            payload: job.data.payload,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
          await markWebhookResult(job.data.endpointId, false);
        }
        throw error;
      }
    }),
  {
    connection: redis,
    concurrency: Number(process.env.ZOLT_WEBHOOK_CONCURRENCY ?? 5),
  },
).on("failed", (job, error) => {
  metrics.increment("zolt_worker_jobs_total", {
    queue: WEBHOOK_DELIVERY_QUEUE,
    status: "failed",
  });
  logError("worker.webhook", error);
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    void enqueueDeadLetter({
      queue: WEBHOOK_DELIVERY_QUEUE,
      reason: error instanceof Error ? error.message : String(error),
      payload: (job.data ?? {}) as Record<string, unknown>,
    });
  }
});

telemetryWorker.on("completed", (job) => {
  metrics.increment("zolt_worker_jobs_total", {
    queue: TELEMETRY_INGEST_QUEUE,
    status: "completed",
  });
  if (job.processedOn) {
    metrics.observe(
      "zolt_worker_processing_duration_ms",
      Math.max(0, Date.now() - job.processedOn),
      { queue: TELEMETRY_INGEST_QUEUE },
    );
    metrics.observe(
      "zolt_queue_delay_ms",
      Math.max(0, job.processedOn - job.timestamp),
      { queue: TELEMETRY_INGEST_QUEUE },
    );
  }
});

webhookWorker.on("completed", (job) => {
  metrics.increment("zolt_worker_jobs_total", {
    queue: WEBHOOK_DELIVERY_QUEUE,
    status: "completed",
  });
  if (job.processedOn) {
    metrics.observe(
      "zolt_worker_processing_duration_ms",
      Math.max(0, Date.now() - job.processedOn),
      { queue: WEBHOOK_DELIVERY_QUEUE },
    );
  }
});

redis.on("ready", () =>
  metrics.gauge("zolt_redis_available", 1, { service: "zolt-worker" }),
);
redis.on("close", () =>
  metrics.gauge("zolt_redis_available", 0, { service: "zolt-worker" }),
);
redis.on("error", () =>
  metrics.increment("zolt_dependency_failures_total", {
    service: "zolt-worker",
    dependency: "redis",
  }),
);

const healthServer = createServer(async (req, res) => {
  const path = req.url ?? "/";
  if (path === "/health/live") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "zolt-worker" }));
    return;
  }
  if (path === "/metrics") {
    res.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
    res.end(metrics.renderPrometheus());
    return;
  }
  if (path === "/health/ready" || path === "/health/ready/") {
    try {
      await pingDatabase(1500);
      const pong = await Promise.race([
        redis.ping(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("REDIS_PING_TIMEOUT")), 1500);
        }),
      ]);
      if (pong !== "PONG") throw new Error("REDIS_UNAVAILABLE");
      const mem = process.memoryUsage();
      let redisMemoryMb: number | undefined;
      try {
        const info = await redis.info("memory");
        const match = /used_memory:(\d+)/.exec(info);
        if (match) redisMemoryMb = Number((Number(match[1]) / 1024 / 1024).toFixed(1));
      } catch {
        redisMemoryMb = undefined;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          service: "zolt-worker",
          rssMb: Number((mem.rss / 1024 / 1024).toFixed(1)),
          heapUsedMb: Number((mem.heapUsed / 1024 / 1024).toFixed(1)),
          redisMemoryMb,
          uptimeSec: Math.round(process.uptime()),
        }),
      );
    } catch {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "degraded", service: "zolt-worker" }));
    }
    return;
  }
  res.writeHead(404);
  res.end();
});
healthServer.listen(Number(process.env.WORKER_HEALTH_PORT ?? 4003), "0.0.0.0");

logInfo("worker.start", {
  message: "Zolt worker online",
  correlationEnabled: true,
});
const retentionTimer = setInterval(
  () => {
    void runRetentionJobs()
      .then((result) => logInfo("worker.retention", result))
      .catch((error) => logError("worker.retention", error));
  },
  Number(process.env.ZOLT_RETENTION_INTERVAL_MS ?? 24 * 60 * 60_000),
);
retentionTimer.unref();

async function shutdown(): Promise<void> {
  clearInterval(retentionTimer);
  healthServer.close();
  await telemetryWorker.close();
  await webhookWorker.close();
  await redis.quit();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
