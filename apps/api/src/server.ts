import "dotenv/config";
import Fastify from "fastify";
import { fileURLToPath } from "node:url";
import { requireApiKey } from "@zolt/auth";
import type {
  RecommendationStatus as RecommendationStatusType,
  ZoltRecommendation,
  ZoltTelemetryEnvelope
} from "@zolt/contracts";
import { RecommendationStatus, TelemetryEnvelopeSchema } from "@zolt/contracts";
import { correlationIdFromRequest } from "@zolt/observability";

export interface ApiDependencies {
  enqueueTelemetry: (envelope: ZoltTelemetryEnvelope) => Promise<void>;
  listTelemetryForInstallation: (input: {
    tenantId: string;
    productId: string;
    installationId: string;
  }) => Promise<ZoltTelemetryEnvelope[]>;
  saveRecommendations: (recommendations: ZoltRecommendation[]) => Promise<void>;
  listRecommendations: (input: {
    tenantId: string;
    productId?: string;
    installationId?: string;
    status?: RecommendationStatusType;
  }) => Promise<ZoltRecommendation[]>;
  updateRecommendationStatus: (input: {
    tenantId: string;
    recommendationId: string;
    status: RecommendationStatusType;
  }) => Promise<void>;
  writeAuditEvent: (input: {
    tenantId: string;
    eventType: string;
    actorType: string;
    subjectType: string;
    subjectId: string;
    metadata?: Record<string, unknown>;
    correlationId?: string;
  }) => Promise<void>;
  readinessCheck: () => Promise<boolean>;
  createOrchestrator: () => {
    analyse: (context: {
      tenantId: string;
      productId: string;
      installationId: string;
      telemetry: ZoltTelemetryEnvelope[];
      analysisTime: string;
      configuration: Record<string, unknown>;
    }) => Promise<ZoltRecommendation[]>;
  };
}

export interface ApiAppOptions {
  logger?: boolean;
}

export function buildApiApp(dependencies: ApiDependencies, options: ApiAppOptions = {}) {
  const loggerEnabled = options.logger ?? !process.env.VITEST;
  const app = Fastify({ logger: loggerEnabled });

  app.get("/health/live", async () => ({
    status: "ok",
    service: "zolt-api",
    advisoryOnly: process.env.ZOLT_ADVISORY_ONLY !== "false"
  }));
  app.get("/health/ready", async (_req, reply) => {
    const ready = await dependencies.readinessCheck();
    if (!ready) {
      return reply.code(503).send({ status: "degraded", service: "zolt-api" });
    }
    return { status: "ok", service: "zolt-api" };
  });

  app.post("/v1/telemetry", { preHandler: requireApiKey }, async (req, reply) => {
    const parsed = TelemetryEnvelopeSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "INVALID_TELEMETRY", issues: parsed.error.issues });
    }

    await dependencies.enqueueTelemetry(parsed.data);
    await dependencies.writeAuditEvent({
      tenantId: parsed.data.tenantId,
      eventType: "TELEMETRY_INGESTED",
      actorType: "API",
      subjectType: "TELEMETRY",
      subjectId: parsed.data.messageId,
      metadata: {
        productId: parsed.data.productId,
        installationId: parsed.data.installationId,
        deviceId: parsed.data.deviceId
      },
      correlationId: correlationIdFromRequest(req)
    });

    return reply.code(202).send({ accepted: true, messageId: parsed.data.messageId });
  });

  app.post("/v1/analysis", { preHandler: requireApiKey }, async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const tenantId = String(body.tenantId ?? "");
    const productId = String(body.productId ?? "");
    const installationId = String(body.installationId ?? "");
    if (!tenantId || !productId || !installationId) {
      return reply.code(400).send({ code: "INVALID_ANALYSIS_REQUEST" });
    }

    if (process.env.ZOLT_ADVISORY_ONLY === "false") {
      return reply.code(409).send({ code: "SAFETY_POLICY_VIOLATION" });
    }

    const telemetry = await dependencies
      .listTelemetryForInstallation({
        tenantId,
        productId,
        installationId
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (message === "INSTALLATION_IDENTITY_NOT_FOUND") {
          return [] as ZoltTelemetryEnvelope[];
        }
        throw error;
      });

    const recommendations = await dependencies.createOrchestrator().analyse({
      tenantId,
      productId,
      installationId,
      telemetry,
      analysisTime: new Date().toISOString(),
      configuration: (body.configuration as Record<string, unknown>) ?? {}
    });

    try {
      await dependencies.saveRecommendations(recommendations);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "INSTALLATION_IDENTITY_NOT_FOUND") {
        return reply.code(404).send({ code: message });
      }
      throw error;
    }
    return { advisoryOnly: true, recommendations };
  });

  app.get("/v1/recommendations", { preHandler: requireApiKey }, async (req, reply) => {
    const query = req.query as Record<string, unknown>;
    const tenantId = String(query.tenantId ?? "");
    if (!tenantId) {
      return reply.code(400).send({
        code: "INVALID_RECOMMENDATIONS_REQUEST",
        message: "tenantId is required"
      });
    }

    const statusCandidate = String(query.status ?? "");
    const status =
      statusCandidate && RecommendationStatus.safeParse(statusCandidate).success
        ? (statusCandidate as RecommendationStatusType)
        : undefined;

    try {
      return await dependencies.listRecommendations({
        tenantId,
        productId: query.productId ? String(query.productId) : undefined,
        installationId: query.installationId ? String(query.installationId) : undefined,
        status
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "INSTALLATION_IDENTITY_NOT_FOUND") {
        return reply.code(404).send({ code: message });
      }
      if (message === "INVALID_RECOMMENDATION_FILTER") {
        return reply.code(400).send({ code: message });
      }
      throw error;
    }
  });

  app.patch(
    "/v1/recommendations/:id/status",
    { preHandler: requireApiKey },
    async (req, reply) => {
      const params = req.params as { id: string };
      const body = req.body as Record<string, unknown>;
      const tenantId = String(body.tenantId ?? "");
      const statusRaw = String(body.status ?? "");
      const parsedStatus = RecommendationStatus.safeParse(statusRaw);

      if (!tenantId || !parsedStatus.success) {
        return reply.code(400).send({ code: "INVALID_RECOMMENDATION_STATUS_REQUEST" });
      }

      try {
        await dependencies.updateRecommendationStatus({
          tenantId,
          recommendationId: params.id,
          status: parsedStatus.data
        });
        await dependencies.writeAuditEvent({
          tenantId,
          eventType: "RECOMMENDATION_STATUS_CHANGED",
          actorType: "API",
          subjectType: "RECOMMENDATION",
          subjectId: params.id,
          metadata: { status: parsedStatus.data },
          correlationId: correlationIdFromRequest(req)
        });
        return { updated: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === "RECOMMENDATION_NOT_FOUND") {
          return reply.code(404).send({ code: message });
        }
        if (message.startsWith("INVALID_RECOMMENDATION_TRANSITION")) {
          return reply.code(409).send({ code: message });
        }
        throw error;
      }
    }
  );

  return app;
}

export async function startApiServer(): Promise<void> {
  const [
    { telemetryHealthSkill, curtailmentRiskSkill },
    { AnalysisOrchestrator },
    database,
    queue
  ] = await Promise.all([
    import("@zolt/capability-energy"),
    import("@zolt/core"),
    import("@zolt/database"),
    import("@zolt/queue")
  ]);

  const dependencies: ApiDependencies = {
    enqueueTelemetry: queue.enqueueTelemetry,
    listTelemetryForInstallation: database.listTelemetryForInstallation,
    saveRecommendations: database.saveRecommendations,
    listRecommendations: database.listRecommendations,
    updateRecommendationStatus: database.updateRecommendationStatus,
    writeAuditEvent: database.writeAuditEvent,
    readinessCheck: async () => {
      try {
        await Promise.all([database.prisma.$queryRaw`SELECT 1`, queue.telemetryQueue().waitUntilReady()]);
        return true;
      } catch {
        return false;
      }
    },
    createOrchestrator: () => new AnalysisOrchestrator([telemetryHealthSkill, curtailmentRiskSkill])
  };

  const app = buildApiApp(dependencies, { logger: true });
  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen({ port, host: "0.0.0.0" });
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  startApiServer().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}
