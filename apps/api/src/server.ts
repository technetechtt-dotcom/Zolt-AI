import "dotenv/config";
import Fastify from "fastify";
import { fileURLToPath } from "node:url";
import {
  applySecurityHeaders,
  assertIdentityBinding,
  assertTlsIfProduction,
  bodyLimitBytes,
  requireApiKey,
  requirePermission,
  setCredentialResolver,
  setSessionResolver
} from "@zolt/auth";
import type { AuthenticatedPrincipal } from "@zolt/auth";
import type {
  RecommendationStatus as RecommendationStatusType,
  ZoltRecommendation,
  ZoltTelemetryEnvelope
} from "@zolt/contracts";
import { MAX_TELEMETRY_BATCH, RecommendationStatus } from "@zolt/contracts";
import { correlationIdFromRequest } from "@zolt/observability";
import { validateTelemetryEnvelope } from "@zolt/core";

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
    actorId?: string;
    comment?: string;
  }) => Promise<void>;
  writeAuditEvent: (input: {
    tenantId: string;
    eventType: string;
    actorType: string;
    actorId?: string;
    subjectType: string;
    subjectId: string;
    metadata?: Record<string, unknown>;
    correlationId?: string;
  }) => Promise<void>;
  readinessCheck: () => Promise<boolean>;
  metrics?: () => Promise<Record<string, unknown>>;
  createOrchestrator: () => {
    analyse: (context: {
      tenantId: string;
      productId: string;
      installationId: string;
      telemetry: ZoltTelemetryEnvelope[];
      analysisTime: string;
      configuration: Record<string, unknown>;
      correlationId?: string;
    }) => Promise<ZoltRecommendation[]>;
  };
  authenticateUser?: (input: { email: string; password: string; tenantId?: string }) => Promise<{
    token: string;
    tenantId: string;
    userId: string;
    name: string;
  } | null>;
  revokeSession?: (token: string) => Promise<void>;
  listUsers?: (tenantId: string) => Promise<unknown[]>;
  inviteUser?: (input: {
    tenantId: string;
    email: string;
    name: string;
    roleKey: string;
    actorId?: string;
  }) => Promise<string>;
  listCredentials?: (tenantId: string) => Promise<unknown[]>;
  createCredential?: (input: {
    tenantId: string;
    name: string;
    productId?: string;
    installationId?: string;
    actorId?: string;
  }) => Promise<unknown>;
  revokeCredential?: (tenantId: string, credentialId: string, actorId?: string) => Promise<void>;
  rotateCredential?: (tenantId: string, credentialId: string, actorId?: string) => Promise<unknown>;
  listWebhooks?: (tenantId: string) => Promise<unknown[]>;
  createWebhook?: (input: { tenantId: string; url: string; events: string[] }) => Promise<string>;
  listAudit?: (tenantId: string) => Promise<unknown[]>;
  listInstallations?: (tenantId: string) => Promise<unknown[]>;
  listDevices?: (tenantId: string, installationId?: string) => Promise<unknown[]>;
  listAssets?: (tenantId: string, installationId?: string) => Promise<unknown[]>;
  recordFeedback?: (input: {
    tenantId: string;
    recommendationId: string;
    useful?: boolean;
    correct?: boolean;
  }) => Promise<void>;
  systemHealth?: () => Promise<Record<string, unknown>>;
  askCopilot?: (input: { tenantId: string; question: string; permissions: string[] }) => Promise<unknown>;
}

export interface ApiAppOptions {
  logger?: boolean;
}

function boundIdentity(req: { zoltAuth?: AuthenticatedPrincipal }, requested: {
  tenantId: string;
  productId?: string;
  installationId?: string;
}) {
  if (!req.zoltAuth) {
    throw new Error("UNAUTHORIZED");
  }
  assertIdentityBinding(req.zoltAuth, requested);
  return {
    tenantId: req.zoltAuth.tenantId,
    productId: requested.productId ?? req.zoltAuth.productId,
    installationId: requested.installationId ?? req.zoltAuth.installationId
  };
}

export function buildApiApp(dependencies: ApiDependencies, options: ApiAppOptions = {}) {
  const loggerEnabled = options.logger ?? !process.env.VITEST;
  const app = Fastify({ logger: loggerEnabled, bodyLimit: bodyLimitBytes(), trustProxy: process.env.ZOLT_TRUST_PROXY === "true" });
  applySecurityHeaders(app);

  app.get("/health/live", async () => ({
    status: "ok",
    service: "zolt-api",
    advisoryOnly: process.env.ZOLT_ADVISORY_ONLY !== "false",
    hardwareExecution: false
  }));
  app.get("/health/ready", async (_req, reply) => {
    const ready = await dependencies.readinessCheck();
    if (!ready) {
      return reply.code(503).send({ status: "degraded", service: "zolt-api" });
    }
    return { status: "ok", service: "zolt-api" };
  });
  app.get("/metrics", async () => (await dependencies.metrics?.()) ?? { service: "zolt-api" });

  app.post("/v1/telemetry", { preHandler: [requireApiKey, requirePermission("telemetry:write")] }, async (req, reply) => {
    const batch = Array.isArray(req.body) ? req.body : [req.body];
    if (batch.length > MAX_TELEMETRY_BATCH) {
      return reply.code(413).send({ code: "TELEMETRY_BATCH_TOO_LARGE" });
    }
    const accepted: string[] = [];
    for (const item of batch) {
      const validated = validateTelemetryEnvelope(item);
      if (!validated.envelope || validated.errors.length > 0) {
        return reply.code(400).send({ code: "INVALID_TELEMETRY", errors: validated.errors });
      }
      try {
        boundIdentity(req, validated.envelope);
      } catch {
        return reply.code(403).send({ code: "TENANT_MISMATCH" });
      }
      await dependencies.enqueueTelemetry(validated.envelope);
      await dependencies.writeAuditEvent({
        tenantId: validated.envelope.tenantId,
        eventType: "TELEMETRY_INGESTED",
        actorType: req.zoltAuth?.actorType ?? "API",
        actorId: req.zoltAuth?.credentialId,
        subjectType: "TELEMETRY",
        subjectId: validated.envelope.messageId,
        metadata: {
          productId: validated.envelope.productId,
          installationId: validated.envelope.installationId,
          deviceId: validated.envelope.deviceId,
          simulated: validated.envelope.simulated === true
        },
        correlationId: correlationIdFromRequest(req)
      });
      accepted.push(validated.envelope.messageId);
    }
    return reply.code(202).send({ accepted: true, messageId: accepted[0], messageIds: accepted });
  });

  app.post("/v1/analysis", { preHandler: [requireApiKey, requirePermission("recommendation:read")] }, async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const tenantId = String(body.tenantId ?? req.zoltAuth?.tenantId ?? "");
    const productId = String(body.productId ?? req.zoltAuth?.productId ?? "");
    const installationId = String(body.installationId ?? req.zoltAuth?.installationId ?? "");
    if (!tenantId || !productId || !installationId) {
      return reply.code(400).send({ code: "INVALID_ANALYSIS_REQUEST" });
    }
    try {
      boundIdentity(req, { tenantId, productId, installationId });
    } catch {
      return reply.code(403).send({ code: "TENANT_MISMATCH" });
    }
    if (process.env.ZOLT_ADVISORY_ONLY === "false") {
      return reply.code(409).send({ code: "SAFETY_POLICY_VIOLATION" });
    }
    const telemetry = await dependencies
      .listTelemetryForInstallation({ tenantId, productId, installationId })
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
      configuration: (body.configuration as Record<string, unknown>) ?? {},
      correlationId: correlationIdFromRequest(req)
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

  app.get("/v1/recommendations", { preHandler: [requireApiKey, requirePermission("recommendation:read")] }, async (req, reply) => {
    const query = req.query as Record<string, unknown>;
    const tenantId = String(query.tenantId ?? req.zoltAuth?.tenantId ?? "");
    if (!tenantId) {
      return reply.code(400).send({ code: "INVALID_RECOMMENDATIONS_REQUEST", message: "tenantId is required" });
    }
    try {
      boundIdentity(req, {
        tenantId,
        productId: query.productId ? String(query.productId) : undefined,
        installationId: query.installationId ? String(query.installationId) : undefined
      });
    } catch {
      return reply.code(403).send({ code: "TENANT_MISMATCH" });
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

  app.patch("/v1/recommendations/:id/status", { preHandler: [requireApiKey] }, async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    const tenantId = String(body.tenantId ?? req.zoltAuth?.tenantId ?? "");
    const parsedStatus = RecommendationStatus.safeParse(String(body.status ?? ""));
    if (!tenantId || !parsedStatus.success) {
      return reply.code(400).send({ code: "INVALID_RECOMMENDATION_STATUS_REQUEST" });
    }
    const permission =
      parsedStatus.data === "ACKNOWLEDGED"
        ? "recommendation:acknowledge"
        : parsedStatus.data === "APPROVED"
          ? "recommendation:approve"
          : parsedStatus.data === "REJECTED"
            ? "recommendation:reject"
            : "recommendation:read";
    if (!req.zoltAuth?.permissions.includes(permission) && !req.zoltAuth?.permissions.includes("admin:manage")) {
      return reply.code(403).send({ code: "FORBIDDEN" });
    }
    try {
      boundIdentity(req, { tenantId });
      await dependencies.updateRecommendationStatus({
        tenantId,
        recommendationId: params.id,
        status: parsedStatus.data,
        actorId: req.zoltAuth?.userId ?? req.zoltAuth?.credentialId,
        comment: body.comment ? String(body.comment) : undefined
      });
      await dependencies.writeAuditEvent({
        tenantId,
        eventType: "RECOMMENDATION_STATUS_CHANGED",
        actorType: req.zoltAuth?.actorType ?? "API",
        actorId: req.zoltAuth?.userId ?? req.zoltAuth?.credentialId,
        subjectType: "RECOMMENDATION",
        subjectId: params.id,
        metadata: { status: parsedStatus.data, comment: body.comment },
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
      if (message === "TENANT_MISMATCH") {
        return reply.code(403).send({ code: message });
      }
      throw error;
    }
  });

  app.post("/v1/auth/login", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const email = String(body.email ?? "");
    const password = String(body.password ?? "");
    if (!email || !password) {
      return reply.code(400).send({ code: "INVALID_LOGIN" });
    }
    try {
      const result = await dependencies.authenticateUser?.({
        email,
        password,
        tenantId: body.tenantId ? String(body.tenantId) : undefined
      });
      if (!result) {
        return reply.code(401).send({ code: "INVALID_CREDENTIALS" });
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "ACCOUNT_LOCKED") {
        return reply.code(423).send({ code: message });
      }
      throw error;
    }
  });

  app.post("/v1/auth/logout", { preHandler: [requireApiKey] }, async (req) => {
    const bearer = String(req.headers.authorization ?? "");
    if (bearer.startsWith("Bearer ")) {
      await dependencies.revokeSession?.(bearer.slice(7));
    }
    return { revoked: true };
  });

  app.get("/v1/me", { preHandler: [requireApiKey] }, async (req) => ({
    tenantId: req.zoltAuth?.tenantId,
    userId: req.zoltAuth?.userId,
    permissions: req.zoltAuth?.permissions ?? [],
    actorType: req.zoltAuth?.actorType
  }));

  app.get("/v1/users", { preHandler: [requireApiKey, requirePermission("admin:manage")] }, async (req) => {
    return (await dependencies.listUsers?.(req.zoltAuth!.tenantId)) ?? [];
  });

  app.post("/v1/users/invite", { preHandler: [requireApiKey, requirePermission("admin:manage")] }, async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    if (!body.email || !body.name || !body.roleKey) {
      return reply.code(400).send({ code: "INVALID_INVITE" });
    }
    const id = await dependencies.inviteUser?.({
      tenantId: req.zoltAuth!.tenantId,
      email: String(body.email),
      name: String(body.name),
      roleKey: String(body.roleKey),
      actorId: req.zoltAuth?.userId
    });
    return { id };
  });

  app.get("/v1/credentials", { preHandler: [requireApiKey, requirePermission("integration:manage")] }, async (req) => {
    return (await dependencies.listCredentials?.(req.zoltAuth!.tenantId)) ?? [];
  });

  app.post("/v1/credentials", { preHandler: [requireApiKey, requirePermission("integration:manage")] }, async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    if (!body.name) {
      return reply.code(400).send({ code: "INVALID_CREDENTIAL" });
    }
    return dependencies.createCredential?.({
      tenantId: req.zoltAuth!.tenantId,
      name: String(body.name),
      productId: body.productId ? String(body.productId) : undefined,
      installationId: body.installationId ? String(body.installationId) : undefined,
      actorId: req.zoltAuth?.userId
    });
  });

  app.post("/v1/credentials/:id/revoke", { preHandler: [requireApiKey, requirePermission("integration:manage")] }, async (req) => {
    const params = req.params as { id: string };
    await dependencies.revokeCredential?.(req.zoltAuth!.tenantId, params.id, req.zoltAuth?.userId);
    return { revoked: true };
  });

  app.post("/v1/credentials/:id/rotate", { preHandler: [requireApiKey, requirePermission("integration:manage")] }, async (req) => {
    const params = req.params as { id: string };
    return dependencies.rotateCredential?.(req.zoltAuth!.tenantId, params.id, req.zoltAuth?.userId);
  });

  app.get("/v1/webhooks", { preHandler: [requireApiKey, requirePermission("webhook:manage")] }, async (req) => {
    return (await dependencies.listWebhooks?.(req.zoltAuth!.tenantId)) ?? [];
  });

  app.post("/v1/webhooks", { preHandler: [requireApiKey, requirePermission("webhook:manage")] }, async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    if (!body.url) {
      return reply.code(400).send({ code: "INVALID_WEBHOOK" });
    }
    const id = await dependencies.createWebhook?.({
      tenantId: req.zoltAuth!.tenantId,
      url: String(body.url),
      events: Array.isArray(body.events) ? body.events.map(String) : ["recommendation.created"]
    });
    return { id };
  });

  app.get("/v1/audit", { preHandler: [requireApiKey, requirePermission("audit:read")] }, async (req) => {
    return (await dependencies.listAudit?.(req.zoltAuth!.tenantId)) ?? [];
  });

  app.get("/v1/installations", { preHandler: [requireApiKey, requirePermission("installation:read")] }, async (req) => {
    return (await dependencies.listInstallations?.(req.zoltAuth!.tenantId)) ?? [];
  });

  app.get("/v1/devices", { preHandler: [requireApiKey, requirePermission("device:read")] }, async (req) => {
    const query = req.query as Record<string, unknown>;
    return (await dependencies.listDevices?.(req.zoltAuth!.tenantId, query.installationId ? String(query.installationId) : undefined)) ?? [];
  });

  app.get("/v1/assets", { preHandler: [requireApiKey, requirePermission("installation:read")] }, async (req) => {
    const query = req.query as Record<string, unknown>;
    return (await dependencies.listAssets?.(req.zoltAuth!.tenantId, query.installationId ? String(query.installationId) : undefined)) ?? [];
  });

  app.get("/v1/telemetry", { preHandler: [requireApiKey, requirePermission("telemetry:read")] }, async (req, reply) => {
    const query = req.query as Record<string, unknown>;
    const tenantId = String(query.tenantId ?? req.zoltAuth?.tenantId ?? "");
    const productId = String(query.productId ?? req.zoltAuth?.productId ?? "");
    const installationId = String(query.installationId ?? req.zoltAuth?.installationId ?? "");
    if (!tenantId || !productId || !installationId) {
      return reply.code(400).send({ code: "INVALID_TELEMETRY_QUERY" });
    }
    try {
      boundIdentity(req, { tenantId, productId, installationId });
    } catch {
      return reply.code(403).send({ code: "TENANT_MISMATCH" });
    }
    return dependencies.listTelemetryForInstallation({ tenantId, productId, installationId });
  });

  app.post("/v1/recommendations/:id/feedback", { preHandler: [requireApiKey, requirePermission("recommendation:acknowledge")] }, async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    const tenantId = String(body.tenantId ?? req.zoltAuth?.tenantId ?? "");
    try {
      boundIdentity(req, { tenantId });
      await dependencies.recordFeedback?.({
        tenantId,
        recommendationId: params.id,
        useful: typeof body.useful === "boolean" ? body.useful : undefined,
        correct: typeof body.correct === "boolean" ? body.correct : undefined
      });
      return { recorded: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "RECOMMENDATION_NOT_FOUND") {
        return reply.code(404).send({ code: message });
      }
      throw error;
    }
  });

  app.get("/v1/health/system", { preHandler: [requireApiKey] }, async () => {
    return (await dependencies.systemHealth?.()) ?? { service: "zolt-api", advisoryOnly: true };
  });

  app.post("/v1/copilot/ask", { preHandler: [requireApiKey, requirePermission("recommendation:read")] }, async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const question = String(body.question ?? "");
    if (!question) {
      return reply.code(400).send({ code: "INVALID_QUESTION" });
    }
    return dependencies.askCopilot?.({
      tenantId: req.zoltAuth!.tenantId,
      question,
      permissions: req.zoltAuth!.permissions
    }) ?? { answer: "Copilot is not configured.", citations: [] };
  });

  return app;
}

export async function startApiServer(): Promise<void> {
  assertTlsIfProduction();
  const [{ energySkills }, { AnalysisOrchestrator }, database, queue, auth, copilot] = await Promise.all([
    import("@zolt/capability-energy"),
    import("@zolt/core"),
    import("@zolt/database"),
    import("@zolt/queue"),
    import("@zolt/auth"),
    import("@zolt/copilot")
  ]);
  setCredentialResolver(database.resolveApiCredential);
  setSessionResolver(database.resolveSession);
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
    metrics: async () => ({
      service: "zolt-api",
      advisoryOnly: true,
      hardwareExecution: false
    }),
    createOrchestrator: () => new AnalysisOrchestrator(energySkills),
    authenticateUser: database.authenticateUser,
    revokeSession: database.revokeSession,
    listUsers: database.listTenantUsers,
    inviteUser: database.inviteUser,
    listCredentials: database.listApiCredentials,
    createCredential: async (input) => {
      const generated = auth.generateApiKey();
      const signing = auth.generateSigningSecret();
      const id = await database.createApiCredential({
        tenantId: input.tenantId,
        name: input.name,
        productId: input.productId,
        installationId: input.installationId,
        permissions: ["telemetry:write", "telemetry:read", "recommendation:read"],
        plaintextKey: generated.plaintext,
        prefix: generated.prefix,
        signingSecret: signing,
        keyHash: auth.hashSecret(generated.plaintext),
        signingSecretEnc: auth.encryptSecret(signing)
      });
      return { id, apiKey: generated.plaintext, signingSecret: signing };
    },
    revokeCredential: database.revokeApiCredential,
    rotateCredential: async (tenantId, credentialId, actorId) => {
      const generated = auth.generateApiKey();
      const signing = auth.generateSigningSecret();
      await database.rotateApiCredential({
        tenantId,
        credentialId,
        plaintextKey: generated.plaintext,
        prefix: generated.prefix,
        keyHash: auth.hashSecret(generated.plaintext),
        signingSecretEnc: auth.encryptSecret(signing),
        actorId
      });
      return { apiKey: generated.plaintext, signingSecret: signing };
    },
    listWebhooks: database.listWebhookEndpoints,
    createWebhook: async (input) =>
      database.createWebhookEndpoint({
        tenantId: input.tenantId,
        url: input.url,
        secretEnc: auth.encryptSecret(auth.generateSigningSecret()),
        events: input.events
      }),
    listAudit: database.listAuditEvents,
    listInstallations: database.listInstallations,
    listDevices: database.listDevices,
    listAssets: database.listAssets,
    recordFeedback: database.recordRecommendationFeedback,
    systemHealth: async () => {
      const ready = await Promise.allSettled([
        database.prisma.$queryRaw`SELECT 1`,
        queue.telemetryQueue().getJobCounts()
      ]);
      return {
        advisoryOnly: true,
        hardwareExecution: false,
        postgres: ready[0]?.status === "fulfilled",
        queue: ready[1]?.status === "fulfilled" ? ready[1].value : null
      };
    },
    askCopilot: copilot.askCopilot
  };
  const app = buildApiApp(dependencies, { logger: true });
  await app.listen({ port: Number(process.env.API_PORT ?? 4000), host: "0.0.0.0" });
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  startApiServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
