import "dotenv/config";
import Fastify from "fastify";
import { fileURLToPath } from "node:url";
import {
  applySecurityHeaders,
  assertProductionConfiguration,
  assertIdentityBinding,
  bodyLimitBytes,
  enforceRateLimit,
  requireApiKey,
  requirePermission,
  setCredentialResolver,
  setSessionResolver,
} from "@zolt/auth";
import type { AuthenticatedPrincipal } from "@zolt/auth";
import type {
  PermissionKey as PermissionKeyType,
  RecommendationStatus as RecommendationStatusType,
  ZoltRecommendation,
  ZoltTelemetryEnvelope,
} from "@zolt/contracts";
import {
  MAX_TELEMETRY_BATCH,
  PermissionKey,
  RecommendationStatus,
} from "@zolt/contracts";
import {
  correlationIdFromRequest,
  instrumentFastify,
  metrics,
} from "@zolt/observability";
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
    userId?: string;
    unrestricted?: boolean;
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
  authenticateUser?: (input: {
    email: string;
    password: string;
    tenantId?: string;
    totpCode?: string;
    recoveryCode?: string;
    deviceName?: string;
    userAgent?: string;
    ipAddress?: string;
  }) => Promise<{
    token: string;
    tenantId: string;
    userId: string;
    name: string;
  } | null>;
  revokeSession?: (token: string) => Promise<void>;
  switchTenantSession?: (input: {
    token: string;
    tenantId: string;
  }) => Promise<{
    token: string;
    tenantId: string;
    userId: string;
    name: string;
  }>;
  listUserTenants?: (input: {
    tenantId: string;
    userId: string;
  }) => Promise<unknown[]>;
  listUsers?: (tenantId: string) => Promise<unknown[]>;
  inviteUser?: (input: {
    tenantId: string;
    email: string;
    name: string;
    roleKey: string;
    actorId?: string;
  }) => Promise<{ id: string; invitationToken: string }>;
  acceptInvitation?: (input: {
    token: string;
    password: string;
  }) => Promise<void>;
  requestPasswordReset?: (email: string) => Promise<string | null>;
  resetPassword?: (input: { token: string; password: string }) => Promise<void>;
  issueEmailVerification?: (userId: string) => Promise<string>;
  verifyEmail?: (token: string) => Promise<void>;
  issueAccountUnlock?: (email: string) => Promise<string | null>;
  unlockAccount?: (token: string) => Promise<void>;
  beginMfaEnrollment?: (input: {
    tenantId: string;
    userId: string;
  }) => Promise<{ secret: string; uri: string }>;
  confirmMfaEnrollment?: (input: {
    tenantId: string;
    userId: string;
    code: string;
  }) => Promise<string[]>;
  listSessions?: (input: {
    tenantId: string;
    userId: string;
  }) => Promise<unknown[]>;
  revokeSessionById?: (input: {
    tenantId: string;
    userId: string;
    sessionId: string;
    actorId: string;
  }) => Promise<void>;
  revokeAllSessions?: (input: {
    tenantId: string;
    userId: string;
    actorId: string;
  }) => Promise<number>;
  deactivateUser?: (input: {
    tenantId: string;
    userId: string;
    actorId: string;
  }) => Promise<void>;
  listDormantUsers?: (tenantId: string) => Promise<unknown[]>;
  listCredentials?: (tenantId: string) => Promise<unknown[]>;
  createCredential?: (input: {
    tenantId: string;
    name: string;
    productId?: string;
    installationId?: string;
    permissions?: string[];
    expiryDays?: number;
    kind?: "API_INTEGRATION" | "SERVICE_ACCOUNT" | "DEVICE";
    userId?: string;
    actorId?: string;
  }) => Promise<unknown>;
  approveCredential?: (
    tenantId: string,
    credentialId: string,
    actorId: string,
  ) => Promise<void>;
  emergencyRevokeCredentials?: (input: {
    tenantId: string;
    userId?: string;
    kind?: "API_INTEGRATION" | "SERVICE_ACCOUNT" | "DEVICE";
    actorId?: string;
  }) => Promise<number>;
  revokeCredential?: (
    tenantId: string,
    credentialId: string,
    actorId?: string,
  ) => Promise<void>;
  rotateCredential?: (
    tenantId: string,
    credentialId: string,
    actorId?: string,
  ) => Promise<unknown>;
  listWebhooks?: (tenantId: string) => Promise<unknown[]>;
  createWebhook?: (input: {
    tenantId: string;
    url: string;
    events: string[];
  }) => Promise<string>;
  rotateWebhookSecret?: (input: {
    tenantId: string;
    endpointId: string;
    secretEnc: string;
    actorId?: string;
  }) => Promise<void>;
  getWebhook?: (
    tenantId: string,
    endpointId: string,
  ) => Promise<{ id: string; url: string; secret: string }>;
  listWebhookDeliveries?: (
    tenantId: string,
    endpointId: string,
  ) => Promise<unknown[]>;
  getWebhookDelivery?: (
    tenantId: string,
    deliveryId: string,
  ) => Promise<{
    endpointId: string;
    eventType: string;
    payload: Record<string, unknown>;
    url: string;
    secret: string;
    originalIdempotencyId: string;
  }>;
  enqueueWebhook?: (input: {
    tenantId: string;
    eventType: string;
    recommendationId: string;
    webhookUrl: string;
    webhookSecret?: string;
    endpointId?: string;
    idempotencyId?: string;
    payload: Record<string, unknown>;
  }) => Promise<void>;
  queueHealth?: () => Promise<Record<string, unknown>>;
  listDeadLetters?: (
    quarantined?: boolean,
    limit?: number,
  ) => Promise<unknown[]>;
  retryDeadLetter?: (jobId: string, quarantined?: boolean) => Promise<void>;
  purgeDeadLetters?: (quarantined?: boolean) => Promise<void>;
  listAudit?: (tenantId: string) => Promise<unknown[]>;
  listInstallations?: (
    tenantId: string,
    userId?: string,
    unrestricted?: boolean,
  ) => Promise<unknown[]>;
  listDevices?: (
    tenantId: string,
    installationId?: string,
    userId?: string,
    unrestricted?: boolean,
  ) => Promise<unknown[]>;
  listAssets?: (
    tenantId: string,
    installationId?: string,
    userId?: string,
    unrestricted?: boolean,
  ) => Promise<unknown[]>;
  hasInstallationAccess?: (input: {
    tenantId: string;
    userId: string;
    installationRef: string;
  }) => Promise<boolean>;
  hasRecommendationAccess?: (input: {
    tenantId: string;
    userId: string;
    recommendationId: string;
  }) => Promise<boolean>;
  recordFeedback?: (input: {
    tenantId: string;
    recommendationId: string;
    useful?: boolean;
    correct?: boolean;
  }) => Promise<void>;
  systemHealth?: () => Promise<Record<string, unknown>>;
  askCopilot?: (input: {
    tenantId: string;
    question: string;
    permissions: string[];
    userId?: string;
    unrestricted?: boolean;
  }) => Promise<unknown>;
  assignRole?: (input: {
    tenantId: string;
    userId: string;
    roleKey: string;
    actorId?: string;
  }) => Promise<void>;
  removeRole?: (input: {
    tenantId: string;
    userId: string;
    roleKey: string;
    actorId?: string;
  }) => Promise<void>;
  listRoles?: (tenantId: string) => Promise<unknown[]>;
  grantAccess?: (input: {
    tenantId: string;
    userId: string;
    installationId: string;
    actorId?: string;
  }) => Promise<void>;
  listModels?: (tenantId: string) => Promise<unknown[]>;
  optimise?: (input: Record<string, number>) => Promise<unknown>;
  billing?: (tenantId: string) => Promise<unknown>;
  exportTenant?: (tenantId: string) => Promise<Record<string, unknown>>;
  offboardTenant?: (input: {
    tenantId: string;
    actorId: string;
  }) => Promise<void>;
  deleteTenant?: (tenantId: string) => Promise<void>;
}

export interface ApiAppOptions {
  logger?: boolean;
}

function boundIdentity(
  req: { zoltAuth?: AuthenticatedPrincipal },
  requested: {
    tenantId: string;
    productId?: string;
    installationId?: string;
  },
) {
  if (!req.zoltAuth) {
    throw new Error("UNAUTHORIZED");
  }
  assertIdentityBinding(req.zoltAuth, requested);
  return {
    tenantId: req.zoltAuth.tenantId,
    productId: requested.productId ?? req.zoltAuth.productId,
    installationId: requested.installationId ?? req.zoltAuth.installationId,
  };
}

function unrestrictedInstallationAccess(
  principal: AuthenticatedPrincipal,
): boolean {
  return (
    !principal.userId ||
    principal.permissions.includes("admin:manage") ||
    principal.permissions.includes("installation:manage")
  );
}

async function canAccessInstallation(
  dependencies: ApiDependencies,
  req: { zoltAuth?: AuthenticatedPrincipal },
  installationRef: string,
): Promise<boolean> {
  const principal = req.zoltAuth;
  if (!principal) return false;
  if (unrestrictedInstallationAccess(principal)) return true;
  return Boolean(
    principal.userId &&
    (await dependencies.hasInstallationAccess?.({
      tenantId: principal.tenantId,
      userId: principal.userId,
      installationRef,
    })),
  );
}

async function canAccessRecommendation(
  dependencies: ApiDependencies,
  req: { zoltAuth?: AuthenticatedPrincipal },
  recommendationId: string,
): Promise<boolean> {
  const principal = req.zoltAuth;
  if (!principal) return false;
  if (unrestrictedInstallationAccess(principal)) return true;
  return Boolean(
    principal.userId &&
    (await dependencies.hasRecommendationAccess?.({
      tenantId: principal.tenantId,
      userId: principal.userId,
      recommendationId,
    })),
  );
}

export function buildApiApp(
  dependencies: ApiDependencies,
  options: ApiAppOptions = {},
) {
  const loggerEnabled = options.logger ?? !process.env.VITEST;
  const app = Fastify({
    logger: loggerEnabled,
    bodyLimit: bodyLimitBytes(),
    trustProxy: process.env.ZOLT_TRUST_PROXY === "true",
  });
  instrumentFastify(app, "zolt-api");
  applySecurityHeaders(app);

  app.get("/health/live", async () => ({
    status: "ok",
    service: "zolt-api",
    advisoryOnly: process.env.ZOLT_ADVISORY_ONLY !== "false",
    hardwareExecution: false,
  }));
  app.get("/health/ready", async (_req, reply) => {
    const ready = await dependencies.readinessCheck();
    if (!ready) {
      return reply.code(503).send({ status: "degraded", service: "zolt-api" });
    }
    return { status: "ok", service: "zolt-api" };
  });
  app.get("/metrics", async (_request, reply) => {
    await dependencies.metrics?.();
    return reply
      .type("text/plain; version=0.0.4; charset=utf-8")
      .send(metrics.renderPrometheus());
  });

  app.post(
    "/v1/telemetry",
    { preHandler: [requireApiKey, requirePermission("telemetry:write")] },
    async (req, reply) => {
      const batch = Array.isArray(req.body) ? req.body : [req.body];
      if (batch.length > MAX_TELEMETRY_BATCH) {
        return reply.code(413).send({ code: "TELEMETRY_BATCH_TOO_LARGE" });
      }
      const accepted: string[] = [];
      for (const item of batch) {
        const validated = validateTelemetryEnvelope(item);
        if (!validated.envelope || validated.errors.length > 0) {
          return reply
            .code(400)
            .send({ code: "INVALID_TELEMETRY", errors: validated.errors });
        }
        try {
          boundIdentity(req, validated.envelope);
        } catch {
          return reply.code(403).send({ code: "TENANT_MISMATCH" });
        }
        if (
          !(await canAccessInstallation(
            dependencies,
            req,
            validated.envelope.installationId,
          ))
        ) {
          return reply.code(403).send({ code: "INSTALLATION_ACCESS_DENIED" });
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
            simulated: validated.envelope.simulated === true,
          },
          correlationId: correlationIdFromRequest(req),
        });
        accepted.push(validated.envelope.messageId);
      }
      return reply
        .code(202)
        .send({ accepted: true, messageId: accepted[0], messageIds: accepted });
    },
  );

  app.post(
    "/v1/analysis",
    { preHandler: [requireApiKey, requirePermission("recommendation:read")] },
    async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      const tenantId = String(body.tenantId ?? req.zoltAuth?.tenantId ?? "");
      const productId = String(body.productId ?? req.zoltAuth?.productId ?? "");
      const installationId = String(
        body.installationId ?? req.zoltAuth?.installationId ?? "",
      );
      if (!tenantId || !productId || !installationId) {
        return reply.code(400).send({ code: "INVALID_ANALYSIS_REQUEST" });
      }
      try {
        boundIdentity(req, { tenantId, productId, installationId });
      } catch {
        return reply.code(403).send({ code: "TENANT_MISMATCH" });
      }
      if (!(await canAccessInstallation(dependencies, req, installationId))) {
        return reply.code(403).send({ code: "INSTALLATION_ACCESS_DENIED" });
      }
      if (process.env.ZOLT_ADVISORY_ONLY === "false") {
        return reply.code(409).send({ code: "SAFETY_POLICY_VIOLATION" });
      }
      const telemetry = await dependencies
        .listTelemetryForInstallation({ tenantId, productId, installationId })
        .catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : String(error);
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
        correlationId: correlationIdFromRequest(req),
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
    },
  );

  app.get(
    "/v1/recommendations",
    { preHandler: [requireApiKey, requirePermission("recommendation:read")] },
    async (req, reply) => {
      const query = req.query as Record<string, unknown>;
      const tenantId = String(query.tenantId ?? req.zoltAuth?.tenantId ?? "");
      if (!tenantId) {
        return reply.code(400).send({
          code: "INVALID_RECOMMENDATIONS_REQUEST",
          message: "tenantId is required",
        });
      }
      try {
        boundIdentity(req, {
          tenantId,
          productId: query.productId ? String(query.productId) : undefined,
          installationId: query.installationId
            ? String(query.installationId)
            : undefined,
        });
      } catch {
        return reply.code(403).send({ code: "TENANT_MISMATCH" });
      }
      const statusCandidate = String(query.status ?? "");
      const status =
        statusCandidate &&
        RecommendationStatus.safeParse(statusCandidate).success
          ? (statusCandidate as RecommendationStatusType)
          : undefined;
      try {
        return await dependencies.listRecommendations({
          tenantId,
          productId: query.productId ? String(query.productId) : undefined,
          installationId: query.installationId
            ? String(query.installationId)
            : undefined,
          status,
          userId: req.zoltAuth?.userId,
          unrestricted: unrestrictedInstallationAccess(req.zoltAuth!),
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
    },
  );

  app.patch(
    "/v1/recommendations/:id/status",
    { preHandler: [requireApiKey] },
    async (req, reply) => {
      const params = req.params as { id: string };
      const body = req.body as Record<string, unknown>;
      const tenantId = String(body.tenantId ?? req.zoltAuth?.tenantId ?? "");
      const parsedStatus = RecommendationStatus.safeParse(
        String(body.status ?? ""),
      );
      if (!tenantId || !parsedStatus.success) {
        return reply
          .code(400)
          .send({ code: "INVALID_RECOMMENDATION_STATUS_REQUEST" });
      }
      const permission =
        parsedStatus.data === "ACKNOWLEDGED"
          ? "recommendation:acknowledge"
          : parsedStatus.data === "APPROVED"
            ? "recommendation:approve"
            : parsedStatus.data === "REJECTED"
              ? "recommendation:reject"
              : "recommendation:read";
      if (
        !req.zoltAuth?.permissions.includes(permission) &&
        !req.zoltAuth?.permissions.includes("admin:manage")
      ) {
        return reply.code(403).send({ code: "FORBIDDEN" });
      }
      if (!(await canAccessRecommendation(dependencies, req, params.id))) {
        return reply.code(403).send({ code: "INSTALLATION_ACCESS_DENIED" });
      }
      try {
        boundIdentity(req, { tenantId });
        await dependencies.updateRecommendationStatus({
          tenantId,
          recommendationId: params.id,
          status: parsedStatus.data,
          actorId: req.zoltAuth?.userId ?? req.zoltAuth?.credentialId,
          comment: body.comment ? String(body.comment) : undefined,
        });
        await dependencies.writeAuditEvent({
          tenantId,
          eventType: "RECOMMENDATION_STATUS_CHANGED",
          actorType: req.zoltAuth?.actorType ?? "API",
          actorId: req.zoltAuth?.userId ?? req.zoltAuth?.credentialId,
          subjectType: "RECOMMENDATION",
          subjectId: params.id,
          metadata: { status: parsedStatus.data, comment: body.comment },
          correlationId: correlationIdFromRequest(req),
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
    },
  );

  app.post("/v1/auth/login", async (req, reply) => {
    if (
      !(await enforceRateLimit(
        req,
        reply,
        `login:${req.ip}`,
        Number(process.env.ZOLT_LOGIN_RATE_LIMIT_PER_MINUTE ?? 10),
      ))
    )
      return;
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
        tenantId: body.tenantId ? String(body.tenantId) : undefined,
        totpCode: body.totpCode ? String(body.totpCode) : undefined,
        recoveryCode: body.recoveryCode ? String(body.recoveryCode) : undefined,
        deviceName: body.deviceName ? String(body.deviceName) : undefined,
        userAgent: String(req.headers["user-agent"] ?? ""),
        ipAddress: req.ip,
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
      if (message === "MFA_REQUIRED")
        return reply.code(401).send({ code: message });
      if (message === "EMAIL_NOT_VERIFIED")
        return reply.code(403).send({ code: message });
      throw error;
    }
  });

  app.post("/v1/auth/invitations/accept", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    if (!body.token || !body.password)
      return reply.code(400).send({ code: "INVALID_INVITATION_ACCEPTANCE" });
    try {
      await dependencies.acceptInvitation?.({
        token: String(body.token),
        password: String(body.password),
      });
      return { accepted: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply
        .code(message.startsWith("PASSWORD_POLICY") ? 400 : 401)
        .send({ code: message });
    }
  });

  app.post("/v1/auth/password-reset/request", async (req, reply) => {
    if (!(await enforceRateLimit(req, reply, `password-reset:${req.ip}`, 5)))
      return;
    const body = req.body as Record<string, unknown>;
    if (!body.email)
      return reply.code(400).send({ code: "INVALID_PASSWORD_RESET" });
    const token = await dependencies.requestPasswordReset?.(String(body.email));
    return {
      accepted: true,
      ...(process.env.NODE_ENV !== "production" && token
        ? { developmentToken: token }
        : {}),
    };
  });

  app.post("/v1/auth/password-reset/confirm", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    if (!body.token || !body.password)
      return reply.code(400).send({ code: "INVALID_PASSWORD_RESET" });
    try {
      await dependencies.resetPassword?.({
        token: String(body.token),
        password: String(body.password),
      });
      return { reset: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply
        .code(message.startsWith("PASSWORD_POLICY") ? 400 : 401)
        .send({ code: message });
    }
  });

  app.post("/v1/auth/email/verify", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    if (!body.token)
      return reply.code(400).send({ code: "INVALID_EMAIL_VERIFICATION" });
    try {
      await dependencies.verifyEmail?.(String(body.token));
      return { verified: true };
    } catch {
      return reply.code(401).send({ code: "ACCOUNT_TOKEN_INVALID_OR_EXPIRED" });
    }
  });

  app.post("/v1/auth/unlock/request", async (req, reply) => {
    if (!(await enforceRateLimit(req, reply, `unlock:${req.ip}`, 5))) return;
    const body = req.body as Record<string, unknown>;
    if (!body.email)
      return reply.code(400).send({ code: "INVALID_UNLOCK_REQUEST" });
    const token = await dependencies.issueAccountUnlock?.(String(body.email));
    return {
      accepted: true,
      ...(process.env.NODE_ENV !== "production" && token
        ? { developmentToken: token }
        : {}),
    };
  });

  app.post("/v1/auth/unlock/confirm", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    if (!body.token)
      return reply.code(400).send({ code: "INVALID_UNLOCK_REQUEST" });
    try {
      await dependencies.unlockAccount?.(String(body.token));
      return { unlocked: true };
    } catch {
      return reply.code(401).send({ code: "ACCOUNT_TOKEN_INVALID_OR_EXPIRED" });
    }
  });

  app.post("/v1/auth/logout", { preHandler: [requireApiKey] }, async (req) => {
    const bearer = String(req.headers.authorization ?? "");
    if (bearer.startsWith("Bearer ")) {
      await dependencies.revokeSession?.(bearer.slice(7));
    }
    return { revoked: true };
  });

  app.post(
    "/v1/auth/switch-tenant",
    { preHandler: [requireApiKey] },
    async (req, reply) => {
      const bearer = String(req.headers.authorization ?? "");
      const body = req.body as Record<string, unknown>;
      if (!bearer.startsWith("Bearer ") || !body.tenantId)
        return reply.code(400).send({ code: "INVALID_TENANT_SWITCH" });
      try {
        return await dependencies.switchTenantSession?.({
          token: bearer.slice(7),
          tenantId: String(body.tenantId),
        });
      } catch {
        return reply.code(403).send({ code: "TENANT_MISMATCH" });
      }
    },
  );

  app.get("/v1/me", { preHandler: [requireApiKey] }, async (req) => ({
    tenantId: req.zoltAuth?.tenantId,
    userId: req.zoltAuth?.userId,
    permissions: req.zoltAuth?.permissions ?? [],
    actorType: req.zoltAuth?.actorType,
  }));

  app.get(
    "/v1/me/tenants",
    { preHandler: [requireApiKey] },
    async (req, reply) => {
      if (!req.zoltAuth?.userId)
        return reply.code(403).send({ code: "USER_SESSION_REQUIRED" });
      return (
        dependencies.listUserTenants?.({
          tenantId: req.zoltAuth.tenantId,
          userId: req.zoltAuth.userId,
        }) ?? []
      );
    },
  );

  app.post(
    "/v1/me/email-verification",
    { preHandler: [requireApiKey] },
    async (req, reply) => {
      if (!req.zoltAuth?.userId)
        return reply.code(403).send({ code: "USER_SESSION_REQUIRED" });
      const token = await dependencies.issueEmailVerification?.(
        req.zoltAuth.userId,
      );
      return {
        accepted: true,
        ...(process.env.NODE_ENV !== "production" && token
          ? { developmentToken: token }
          : {}),
      };
    },
  );

  app.post(
    "/v1/me/mfa/enrol",
    { preHandler: [requireApiKey] },
    async (req, reply) => {
      if (!req.zoltAuth?.userId)
        return reply.code(403).send({ code: "USER_SESSION_REQUIRED" });
      return dependencies.beginMfaEnrollment?.({
        tenantId: req.zoltAuth.tenantId,
        userId: req.zoltAuth.userId,
      });
    },
  );

  app.post(
    "/v1/me/mfa/confirm",
    { preHandler: [requireApiKey] },
    async (req, reply) => {
      if (!req.zoltAuth?.userId)
        return reply.code(403).send({ code: "USER_SESSION_REQUIRED" });
      const body = req.body as Record<string, unknown>;
      if (!body.code)
        return reply.code(400).send({ code: "MFA_CODE_REQUIRED" });
      try {
        const recoveryCodes = await dependencies.confirmMfaEnrollment?.({
          tenantId: req.zoltAuth.tenantId,
          userId: req.zoltAuth.userId,
          code: String(body.code),
        });
        return { enabled: true, recoveryCodes };
      } catch {
        return reply.code(401).send({ code: "MFA_CODE_INVALID" });
      }
    },
  );

  app.get(
    "/v1/me/sessions",
    { preHandler: [requireApiKey] },
    async (req, reply) => {
      if (!req.zoltAuth?.userId)
        return reply.code(403).send({ code: "USER_SESSION_REQUIRED" });
      return (
        dependencies.listSessions?.({
          tenantId: req.zoltAuth.tenantId,
          userId: req.zoltAuth.userId,
        }) ?? []
      );
    },
  );

  app.delete(
    "/v1/me/sessions",
    { preHandler: [requireApiKey] },
    async (req, reply) => {
      if (!req.zoltAuth?.userId)
        return reply.code(403).send({ code: "USER_SESSION_REQUIRED" });
      const count = await dependencies.revokeAllSessions?.({
        tenantId: req.zoltAuth.tenantId,
        userId: req.zoltAuth.userId,
        actorId: req.zoltAuth.userId,
      });
      return { revoked: count ?? 0 };
    },
  );

  app.delete(
    "/v1/me/sessions/:sessionId",
    { preHandler: [requireApiKey] },
    async (req, reply) => {
      if (!req.zoltAuth?.userId)
        return reply.code(403).send({ code: "USER_SESSION_REQUIRED" });
      const params = req.params as { sessionId: string };
      await dependencies.revokeSessionById?.({
        tenantId: req.zoltAuth.tenantId,
        userId: req.zoltAuth.userId,
        sessionId: params.sessionId,
        actorId: req.zoltAuth.userId,
      });
      return { revoked: true };
    },
  );

  app.get(
    "/v1/users",
    { preHandler: [requireApiKey, requirePermission("admin:manage")] },
    async (req) => {
      return (await dependencies.listUsers?.(req.zoltAuth!.tenantId)) ?? [];
    },
  );

  app.post(
    "/v1/users/invite",
    { preHandler: [requireApiKey, requirePermission("admin:manage")] },
    async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      if (!body.email || !body.name || !body.roleKey) {
        return reply.code(400).send({ code: "INVALID_INVITE" });
      }
      const invitation = await dependencies.inviteUser?.({
        tenantId: req.zoltAuth!.tenantId,
        email: String(body.email),
        name: String(body.name),
        roleKey: String(body.roleKey),
        actorId: req.zoltAuth?.userId,
      });
      if (!invitation) return { id: undefined };
      return process.env.NODE_ENV === "production"
        ? { id: invitation.id }
        : invitation;
    },
  );

  app.get(
    "/v1/users/dormant",
    { preHandler: [requireApiKey, requirePermission("admin:manage")] },
    async (req) => {
      return dependencies.listDormantUsers?.(req.zoltAuth!.tenantId) ?? [];
    },
  );

  app.delete(
    "/v1/users/:id/sessions/:sessionId",
    { preHandler: [requireApiKey, requirePermission("admin:manage")] },
    async (req) => {
      const params = req.params as { id: string; sessionId: string };
      await dependencies.revokeSessionById?.({
        tenantId: req.zoltAuth!.tenantId,
        userId: params.id,
        sessionId: params.sessionId,
        actorId: req.zoltAuth!.userId!,
      });
      return { revoked: true };
    },
  );

  app.delete(
    "/v1/users/:id/sessions",
    { preHandler: [requireApiKey, requirePermission("admin:manage")] },
    async (req) => {
      const params = req.params as { id: string };
      const count = await dependencies.revokeAllSessions?.({
        tenantId: req.zoltAuth!.tenantId,
        userId: params.id,
        actorId: req.zoltAuth!.userId!,
      });
      return { revoked: count ?? 0 };
    },
  );

  app.post(
    "/v1/users/:id/deactivate",
    { preHandler: [requireApiKey, requirePermission("admin:manage")] },
    async (req) => {
      const params = req.params as { id: string };
      await dependencies.deactivateUser?.({
        tenantId: req.zoltAuth!.tenantId,
        userId: params.id,
        actorId: req.zoltAuth!.userId!,
      });
      return { deactivated: true };
    },
  );

  app.get(
    "/v1/credentials",
    { preHandler: [requireApiKey, requirePermission("integration:manage")] },
    async (req) => {
      return (
        (await dependencies.listCredentials?.(req.zoltAuth!.tenantId)) ?? []
      );
    },
  );

  app.post(
    "/v1/credentials",
    { preHandler: [requireApiKey, requirePermission("integration:manage")] },
    async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      if (!body.name) {
        return reply.code(400).send({ code: "INVALID_CREDENTIAL" });
      }
      const requestedPermissions = Array.isArray(body.permissions)
        ? body.permissions.map(String)
        : ["telemetry:write", "telemetry:read", "recommendation:read"];
      if (
        requestedPermissions.some(
          (permission) => !PermissionKey.safeParse(permission).success,
        )
      ) {
        return reply.code(400).send({ code: "INVALID_CREDENTIAL_PERMISSION" });
      }
      const kind = String(body.kind ?? "API_INTEGRATION");
      if (!["API_INTEGRATION", "SERVICE_ACCOUNT", "DEVICE"].includes(kind))
        return reply.code(400).send({ code: "INVALID_CREDENTIAL_KIND" });
      try {
        return await dependencies.createCredential?.({
          tenantId: req.zoltAuth!.tenantId,
          name: String(body.name),
          productId: body.productId ? String(body.productId) : undefined,
          installationId: body.installationId
            ? String(body.installationId)
            : undefined,
          permissions: requestedPermissions,
          expiryDays:
            body.expiryDays === undefined ? undefined : Number(body.expiryDays),
          kind: kind as "API_INTEGRATION" | "SERVICE_ACCOUNT" | "DEVICE",
          userId: body.userId ? String(body.userId) : undefined,
          actorId: req.zoltAuth?.userId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith("CREDENTIAL_"))
          return reply.code(400).send({ code: message });
        throw error;
      }
    },
  );

  app.post(
    "/v1/credentials/:id/approve",
    { preHandler: [requireApiKey, requirePermission("admin:manage")] },
    async (req, reply) => {
      if (!req.zoltAuth?.userId)
        return reply.code(403).send({ code: "USER_SESSION_REQUIRED" });
      const params = req.params as { id: string };
      await dependencies.approveCredential?.(
        req.zoltAuth.tenantId,
        params.id,
        req.zoltAuth.userId,
      );
      return { approved: true };
    },
  );

  app.post(
    "/v1/credentials/emergency-revoke",
    { preHandler: [requireApiKey, requirePermission("admin:manage")] },
    async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      if (!body.userId && !body.kind)
        return reply
          .code(400)
          .send({ code: "CREDENTIAL_REVOCATION_SCOPE_REQUIRED" });
      const count = await dependencies.emergencyRevokeCredentials?.({
        tenantId: req.zoltAuth!.tenantId,
        userId: body.userId ? String(body.userId) : undefined,
        kind: body.kind as
          "API_INTEGRATION" | "SERVICE_ACCOUNT" | "DEVICE" | undefined,
        actorId: req.zoltAuth?.userId,
      });
      return { revoked: count ?? 0 };
    },
  );

  app.post(
    "/v1/credentials/:id/revoke",
    { preHandler: [requireApiKey, requirePermission("integration:manage")] },
    async (req) => {
      const params = req.params as { id: string };
      await dependencies.revokeCredential?.(
        req.zoltAuth!.tenantId,
        params.id,
        req.zoltAuth?.userId,
      );
      return { revoked: true };
    },
  );

  app.post(
    "/v1/credentials/:id/rotate",
    { preHandler: [requireApiKey, requirePermission("integration:manage")] },
    async (req) => {
      const params = req.params as { id: string };
      return dependencies.rotateCredential?.(
        req.zoltAuth!.tenantId,
        params.id,
        req.zoltAuth?.userId,
      );
    },
  );

  app.get(
    "/v1/webhooks",
    { preHandler: [requireApiKey, requirePermission("webhook:manage")] },
    async (req) => {
      return (await dependencies.listWebhooks?.(req.zoltAuth!.tenantId)) ?? [];
    },
  );

  app.post(
    "/v1/webhooks",
    { preHandler: [requireApiKey, requirePermission("webhook:manage")] },
    async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      if (!body.url) {
        return reply.code(400).send({ code: "INVALID_WEBHOOK" });
      }
      try {
        const id = await dependencies.createWebhook?.({
          tenantId: req.zoltAuth!.tenantId,
          url: String(body.url),
          events: Array.isArray(body.events)
            ? body.events.map(String)
            : ["recommendation.created"],
        });
        return { id };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith("WEBHOOK_URL")) {
          return reply.code(400).send({ code: message });
        }
        throw error;
      }
    },
  );

  app.post(
    "/v1/webhooks/:id/rotate-secret",
    { preHandler: [requireApiKey, requirePermission("webhook:manage")] },
    async (req) => {
      const params = req.params as { id: string };
      const secret = (await import("@zolt/auth")).generateSigningSecret();
      await dependencies.rotateWebhookSecret?.({
        tenantId: req.zoltAuth!.tenantId,
        endpointId: params.id,
        secretEnc: (await import("@zolt/auth")).encryptSecret(secret),
        actorId: req.zoltAuth?.userId,
      });
      return { secret };
    },
  );

  app.post(
    "/v1/webhooks/:id/test",
    { preHandler: [requireApiKey, requirePermission("webhook:manage")] },
    async (req) => {
      const params = req.params as { id: string };
      const endpoint = await dependencies.getWebhook?.(
        req.zoltAuth!.tenantId,
        params.id,
      );
      if (!endpoint) return { queued: false };
      await dependencies.enqueueWebhook?.({
        tenantId: req.zoltAuth!.tenantId,
        eventType: "webhook.test",
        recommendationId: `test-${Date.now()}`,
        webhookUrl: endpoint.url,
        webhookSecret: endpoint.secret,
        endpointId: endpoint.id,
        idempotencyId: `${endpoint.id}:test:${Date.now()}`,
        payload: {
          event: "webhook.test",
          tenantId: req.zoltAuth!.tenantId,
          sentAt: new Date().toISOString(),
        },
      });
      return { queued: true };
    },
  );

  app.get(
    "/v1/webhooks/:id/deliveries",
    { preHandler: [requireApiKey, requirePermission("webhook:manage")] },
    async (req) => {
      const params = req.params as { id: string };
      return (
        dependencies.listWebhookDeliveries?.(
          req.zoltAuth!.tenantId,
          params.id,
        ) ?? []
      );
    },
  );

  app.post(
    "/v1/webhooks/deliveries/:id/redeliver",
    { preHandler: [requireApiKey, requirePermission("webhook:manage")] },
    async (req) => {
      const params = req.params as { id: string };
      const delivery = await dependencies.getWebhookDelivery?.(
        req.zoltAuth!.tenantId,
        params.id,
      );
      if (!delivery) return { queued: false };
      await dependencies.enqueueWebhook?.({
        tenantId: req.zoltAuth!.tenantId,
        eventType: delivery.eventType,
        recommendationId: `redelivery-${params.id}`,
        webhookUrl: delivery.url,
        webhookSecret: delivery.secret,
        endpointId: delivery.endpointId,
        idempotencyId: `${delivery.originalIdempotencyId}:redelivery:${Date.now()}`,
        payload: delivery.payload,
      });
      return { queued: true };
    },
  );

  app.get(
    "/v1/queues/health",
    { preHandler: [requireApiKey, requirePermission("admin:manage")] },
    async () => {
      return dependencies.queueHealth?.() ?? {};
    },
  );

  app.get(
    "/v1/queues/dead-letter",
    { preHandler: [requireApiKey, requirePermission("admin:manage")] },
    async (req) => {
      const query = req.query as Record<string, unknown>;
      return (
        dependencies.listDeadLetters?.(
          String(query.quarantined ?? "false") === "true",
          Math.min(500, Number(query.limit ?? 100)),
        ) ?? []
      );
    },
  );

  app.post(
    "/v1/queues/dead-letter/:id/retry",
    { preHandler: [requireApiKey, requirePermission("admin:manage")] },
    async (req) => {
      const params = req.params as { id: string };
      const body = req.body as Record<string, unknown> | undefined;
      await dependencies.retryDeadLetter?.(
        params.id,
        body?.quarantined === true,
      );
      return { retried: true };
    },
  );

  app.delete(
    "/v1/queues/dead-letter",
    { preHandler: [requireApiKey, requirePermission("admin:manage")] },
    async (req) => {
      const query = req.query as Record<string, unknown>;
      await dependencies.purgeDeadLetters?.(
        String(query.quarantined ?? "false") === "true",
      );
      return { purged: true };
    },
  );

  app.get(
    "/v1/audit",
    { preHandler: [requireApiKey, requirePermission("audit:read")] },
    async (req) => {
      return (await dependencies.listAudit?.(req.zoltAuth!.tenantId)) ?? [];
    },
  );

  app.get(
    "/v1/installations",
    { preHandler: [requireApiKey, requirePermission("installation:read")] },
    async (req) => {
      return (
        (await dependencies.listInstallations?.(
          req.zoltAuth!.tenantId,
          req.zoltAuth?.userId,
          unrestrictedInstallationAccess(req.zoltAuth!),
        )) ?? []
      );
    },
  );

  app.get(
    "/v1/devices",
    { preHandler: [requireApiKey, requirePermission("device:read")] },
    async (req) => {
      const query = req.query as Record<string, unknown>;
      const installationId = query.installationId
        ? String(query.installationId)
        : undefined;
      if (
        installationId &&
        !(await canAccessInstallation(dependencies, req, installationId))
      )
        return [];
      return (
        (await dependencies.listDevices?.(
          req.zoltAuth!.tenantId,
          installationId,
          req.zoltAuth?.userId,
          unrestrictedInstallationAccess(req.zoltAuth!),
        )) ?? []
      );
    },
  );

  app.get(
    "/v1/assets",
    { preHandler: [requireApiKey, requirePermission("installation:read")] },
    async (req) => {
      const query = req.query as Record<string, unknown>;
      const installationId = query.installationId
        ? String(query.installationId)
        : undefined;
      if (
        installationId &&
        !(await canAccessInstallation(dependencies, req, installationId))
      )
        return [];
      return (
        (await dependencies.listAssets?.(
          req.zoltAuth!.tenantId,
          installationId,
          req.zoltAuth?.userId,
          unrestrictedInstallationAccess(req.zoltAuth!),
        )) ?? []
      );
    },
  );

  app.get(
    "/v1/telemetry",
    { preHandler: [requireApiKey, requirePermission("telemetry:read")] },
    async (req, reply) => {
      const query = req.query as Record<string, unknown>;
      const tenantId = String(query.tenantId ?? req.zoltAuth?.tenantId ?? "");
      const productId = String(
        query.productId ?? req.zoltAuth?.productId ?? "",
      );
      const installationId = String(
        query.installationId ?? req.zoltAuth?.installationId ?? "",
      );
      if (!tenantId || !productId || !installationId) {
        return reply.code(400).send({ code: "INVALID_TELEMETRY_QUERY" });
      }
      try {
        boundIdentity(req, { tenantId, productId, installationId });
      } catch {
        return reply.code(403).send({ code: "TENANT_MISMATCH" });
      }
      if (!(await canAccessInstallation(dependencies, req, installationId)))
        return reply.code(403).send({ code: "INSTALLATION_ACCESS_DENIED" });
      return dependencies.listTelemetryForInstallation({
        tenantId,
        productId,
        installationId,
      });
    },
  );

  app.post(
    "/v1/recommendations/:id/feedback",
    {
      preHandler: [
        requireApiKey,
        requirePermission("recommendation:acknowledge"),
      ],
    },
    async (req, reply) => {
      const params = req.params as { id: string };
      const body = req.body as Record<string, unknown>;
      const tenantId = String(body.tenantId ?? req.zoltAuth?.tenantId ?? "");
      try {
        boundIdentity(req, { tenantId });
        if (!(await canAccessRecommendation(dependencies, req, params.id)))
          return reply.code(403).send({ code: "INSTALLATION_ACCESS_DENIED" });
        await dependencies.recordFeedback?.({
          tenantId,
          recommendationId: params.id,
          useful: typeof body.useful === "boolean" ? body.useful : undefined,
          correct: typeof body.correct === "boolean" ? body.correct : undefined,
        });
        return { recorded: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === "RECOMMENDATION_NOT_FOUND") {
          return reply.code(404).send({ code: message });
        }
        throw error;
      }
    },
  );

  app.get("/v1/health/system", { preHandler: [requireApiKey] }, async () => {
    return (
      (await dependencies.systemHealth?.()) ?? {
        service: "zolt-api",
        advisoryOnly: true,
      }
    );
  });

  app.post(
    "/v1/copilot/ask",
    { preHandler: [requireApiKey, requirePermission("recommendation:read")] },
    async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      const question = String(body.question ?? "");
      if (!question) {
        return reply.code(400).send({ code: "INVALID_QUESTION" });
      }
      return (
        dependencies.askCopilot?.({
          tenantId: req.zoltAuth!.tenantId,
          question,
          permissions: req.zoltAuth!.permissions,
          userId: req.zoltAuth?.userId,
          unrestricted: unrestrictedInstallationAccess(req.zoltAuth!),
        }) ?? { answer: "Copilot is not configured.", citations: [] }
      );
    },
  );

  app.get(
    "/v1/roles",
    { preHandler: [requireApiKey, requirePermission("admin:manage")] },
    async (req) => {
      return (await dependencies.listRoles?.(req.zoltAuth!.tenantId)) ?? [];
    },
  );

  app.post(
    "/v1/users/:id/roles",
    { preHandler: [requireApiKey, requirePermission("admin:manage")] },
    async (req, reply) => {
      const params = req.params as { id: string };
      const body = req.body as Record<string, unknown>;
      if (!body.roleKey) {
        return reply.code(400).send({ code: "INVALID_ROLE" });
      }
      await dependencies.assignRole?.({
        tenantId: req.zoltAuth!.tenantId,
        userId: params.id,
        roleKey: String(body.roleKey),
        actorId: req.zoltAuth?.userId,
      });
      return { assigned: true };
    },
  );

  app.delete(
    "/v1/users/:id/roles/:roleKey",
    { preHandler: [requireApiKey, requirePermission("admin:manage")] },
    async (req) => {
      const params = req.params as { id: string; roleKey: string };
      await dependencies.removeRole?.({
        tenantId: req.zoltAuth!.tenantId,
        userId: params.id,
        roleKey: params.roleKey,
        actorId: req.zoltAuth?.userId,
      });
      return { removed: true };
    },
  );

  app.post(
    "/v1/installations/:id/access",
    { preHandler: [requireApiKey, requirePermission("admin:manage")] },
    async (req, reply) => {
      const params = req.params as { id: string };
      const body = req.body as Record<string, unknown>;
      if (!body.userId) {
        return reply.code(400).send({ code: "INVALID_ACCESS" });
      }
      await dependencies.grantAccess?.({
        tenantId: req.zoltAuth!.tenantId,
        userId: String(body.userId),
        installationId: params.id,
        actorId: req.zoltAuth?.userId,
      });
      return { granted: true };
    },
  );

  app.get(
    "/v1/models",
    { preHandler: [requireApiKey, requirePermission("recommendation:read")] },
    async (req) => {
      return (await dependencies.listModels?.(req.zoltAuth!.tenantId)) ?? [];
    },
  );

  app.post(
    "/v1/optimisation",
    { preHandler: [requireApiKey, requirePermission("recommendation:read")] },
    async (req) => {
      const body = req.body as Record<string, unknown>;
      return dependencies.optimise?.({
        forecastKw: Number(body.forecastKw ?? 0),
        exportLimitKw: Number(body.exportLimitKw ?? 0),
        loadKw: Number(body.loadKw ?? 0),
        batterySocPct: Number(body.batterySocPct ?? 50),
        batteryPowerKw: Number(body.batteryPowerKw ?? 50),
        hydrogenCapacityKgPerHour: Number(body.hydrogenCapacityKgPerHour ?? 0),
        tariff: Number(body.tariff ?? 1.2),
      });
    },
  );

  app.get(
    "/v1/billing",
    { preHandler: [requireApiKey, requirePermission("admin:manage")] },
    async (req) => {
      return (
        (await dependencies.billing?.(req.zoltAuth!.tenantId)) ?? {
          plan: "pilot",
        }
      );
    },
  );

  app.get(
    "/v1/tenant/export",
    { preHandler: [requireApiKey, requirePermission("admin:manage")] },
    async (req) => {
      return dependencies.exportTenant?.(req.zoltAuth!.tenantId) ?? {};
    },
  );

  app.post(
    "/v1/tenant/offboard",
    { preHandler: [requireApiKey, requirePermission("admin:manage")] },
    async (req, reply) => {
      if (!req.zoltAuth?.userId)
        return reply.code(403).send({ code: "USER_SESSION_REQUIRED" });
      const body = req.body as Record<string, unknown>;
      if (body.confirmation !== req.zoltAuth.tenantId)
        return reply.code(400).send({ code: "TENANT_CONFIRMATION_REQUIRED" });
      await dependencies.offboardTenant?.({
        tenantId: req.zoltAuth.tenantId,
        actorId: req.zoltAuth.userId,
      });
      return { offboarded: true };
    },
  );

  app.delete(
    "/v1/tenant",
    { preHandler: [requireApiKey, requirePermission("admin:manage")] },
    async (req, reply) => {
      if (!req.zoltAuth?.userId)
        return reply.code(403).send({ code: "USER_SESSION_REQUIRED" });
      const body = req.body as Record<string, unknown>;
      if (body.confirmation !== `DELETE ${req.zoltAuth!.tenantId}`)
        return reply
          .code(400)
          .send({ code: "TENANT_DELETE_CONFIRMATION_REQUIRED" });
      await dependencies.offboardTenant?.({
        tenantId: req.zoltAuth.tenantId,
        actorId: req.zoltAuth.userId,
      });
      await dependencies.deleteTenant?.(req.zoltAuth!.tenantId);
      return { deleted: true };
    },
  );

  app.get(
    "/v1/telemetry/stream",
    { preHandler: [requireApiKey, requirePermission("telemetry:read")] },
    async (req, reply) => {
      const query = req.query as Record<string, unknown>;
      const tenantId = String(query.tenantId ?? req.zoltAuth?.tenantId ?? "");
      const productId = String(query.productId ?? "");
      const installationId = String(query.installationId ?? "");
      if (!tenantId || !productId || !installationId) {
        return reply.code(400).send({ code: "INVALID_TELEMETRY_QUERY" });
      }
      try {
        boundIdentity(req, { tenantId, productId, installationId });
      } catch {
        return reply.code(403).send({ code: "TENANT_MISMATCH" });
      }
      if (!(await canAccessInstallation(dependencies, req, installationId)))
        return reply.code(403).send({ code: "INSTALLATION_ACCESS_DENIED" });
      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const send = async () => {
        const rows = await dependencies.listTelemetryForInstallation({
          tenantId,
          productId,
          installationId,
        });
        reply.raw.write(`data: ${JSON.stringify(rows.slice(0, 60))}\n\n`);
      };
      await send();
      const timer = setInterval(() => {
        void send();
      }, 5000);
      req.raw.on("close", () => clearInterval(timer));
    },
  );

  return app;
}

export async function startApiServer(): Promise<void> {
  assertProductionConfiguration("api");
  const [
    { energySkills },
    { AnalysisOrchestrator },
    database,
    queue,
    auth,
    copilot,
  ] = await Promise.all([
    import("@zolt/capability-energy"),
    import("@zolt/core"),
    import("@zolt/database"),
    import("@zolt/queue"),
    import("@zolt/auth"),
    import("@zolt/copilot"),
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
        await Promise.all([
          database.prisma.$queryRaw`SELECT 1`,
          queue.telemetryQueue().waitUntilReady(),
        ]);
        return true;
      } catch {
        return false;
      }
    },
    metrics: async () => {
      try {
        const health = (await queue.queueHealth()) as Record<
          string,
          Record<string, number>
        >;
        for (const [queueName, values] of Object.entries(health)) {
          for (const [state, value] of Object.entries(values)) {
            metrics.gauge(
              state === "oldestMessageAgeMs"
                ? "zolt_queue_oldest_message_age_ms"
                : "zolt_queue_jobs",
              value,
              state === "oldestMessageAgeMs"
                ? { queue: queueName }
                : { queue: queueName, state },
            );
          }
        }
        metrics.gauge("zolt_redis_available", 1, { service: "zolt-api" });
        return health;
      } catch {
        metrics.gauge("zolt_redis_available", 0, { service: "zolt-api" });
        metrics.increment("zolt_dependency_failures_total", {
          service: "zolt-api",
          dependency: "redis",
        });
        return {};
      }
    },
    createOrchestrator: () => new AnalysisOrchestrator(energySkills),
    authenticateUser: database.authenticateUser,
    revokeSession: database.revokeSession,
    switchTenantSession: database.switchTenantSession,
    listUserTenants: database.listUserTenants,
    acceptInvitation: database.acceptInvitation,
    requestPasswordReset: database.requestPasswordReset,
    resetPassword: database.resetPassword,
    issueEmailVerification: database.issueEmailVerification,
    verifyEmail: database.verifyEmail,
    issueAccountUnlock: database.issueAccountUnlock,
    unlockAccount: database.unlockAccount,
    beginMfaEnrollment: database.beginMfaEnrollment,
    confirmMfaEnrollment: database.confirmMfaEnrollment,
    listSessions: database.listUserSessions,
    revokeSessionById: database.revokeSessionById,
    revokeAllSessions: database.revokeAllUserSessions,
    deactivateUser: database.deactivateUser,
    listDormantUsers: database.listDormantUsers,
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
        permissions: (input.permissions ?? [
          "telemetry:write",
          "telemetry:read",
          "recommendation:read",
        ]) as PermissionKeyType[],
        plaintextKey: generated.plaintext,
        prefix: generated.prefix,
        signingSecret: signing,
        keyHash: auth.hashSecret(generated.plaintext),
        signingSecretEnc: auth.encryptSecret(signing),
        expiresAt: database.credentialExpiryFromDays(input.expiryDays),
        kind: input.kind,
        userId: input.userId,
      });
      const highRisk = (input.permissions ?? []).some((permission) =>
        ["admin:manage", "integration:manage", "webhook:manage"].includes(
          permission,
        ),
      );
      return {
        id,
        status: highRisk ? "PENDING_APPROVAL" : "ACTIVE",
        apiKey: generated.plaintext,
        signingSecret: signing,
      };
    },
    approveCredential: (tenantId, credentialId, actorId) =>
      database.approveApiCredential({ tenantId, credentialId, actorId }),
    emergencyRevokeCredentials: database.revokeCredentialsForIdentity,
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
        actorId,
      });
      return { apiKey: generated.plaintext, signingSecret: signing };
    },
    listWebhooks: database.listWebhookEndpoints,
    rotateWebhookSecret: database.rotateWebhookSecret,
    getWebhook: database.getWebhookForDelivery,
    listWebhookDeliveries: database.listWebhookDeliveries,
    getWebhookDelivery: database.getWebhookDeliveryForRedelivery,
    enqueueWebhook: queue.enqueueWebhookDelivery,
    queueHealth: queue.queueHealth,
    listDeadLetters: queue.listDeadLetters,
    retryDeadLetter: queue.retryDeadLetter,
    purgeDeadLetters: queue.purgeDeadLetters,
    createWebhook: async (input) =>
      database.createWebhookEndpoint({
        tenantId: input.tenantId,
        url: input.url,
        secretEnc: auth.encryptSecret(auth.generateSigningSecret()),
        events: input.events,
      }),
    listAudit: database.listAuditEvents,
    listInstallations: database.listInstallations,
    listDevices: database.listDevices,
    listAssets: database.listAssets,
    hasInstallationAccess: database.hasInstallationAccess,
    hasRecommendationAccess: database.hasRecommendationAccess,
    recordFeedback: database.recordRecommendationFeedback,
    systemHealth: async () => {
      const ready = await Promise.allSettled([
        database.prisma.$queryRaw`SELECT 1`,
        queue.telemetryQueue().getJobCounts(),
      ]);
      return {
        advisoryOnly: true,
        hardwareExecution: false,
        postgres: ready[0]?.status === "fulfilled",
        queue: ready[1]?.status === "fulfilled" ? ready[1].value : null,
      };
    },
    askCopilot: async (input) => {
      const [recommendations, installations, audit] = await Promise.all([
        database.listRecommendations({
          tenantId: input.tenantId,
          userId: input.userId,
          unrestricted: input.unrestricted,
          limit: 25,
        }),
        database.listInstallations(
          input.tenantId,
          input.userId,
          input.unrestricted,
        ),
        input.permissions.includes("audit:read") ||
        input.permissions.includes("admin:manage")
          ? database.listAuditEvents(input.tenantId, 25)
          : Promise.resolve([]),
      ]);
      return copilot.askCopilot({
        tenantId: input.tenantId,
        question: input.question,
        permissions: input.permissions,
        sources: [
          {
            id: "tenant-installations",
            title: "Accessible installations",
            data: installations,
            requiredPermission: "installation:read",
          },
          {
            id: "tenant-recommendations",
            title: "Accessible recommendations",
            data: recommendations,
            requiredPermission: "recommendation:read",
          },
          {
            id: "tenant-audit",
            title: "Tenant audit events",
            data: audit,
            requiredPermission: "audit:read",
          },
        ],
      });
    },
    assignRole: database.assignUserRole,
    removeRole: database.removeUserRole,
    listRoles: database.listTenantRoles,
    grantAccess: database.grantInstallationAccess,
    listModels: async (tenantId) => {
      const { listModels, registerModel } = await import("@zolt/mlops");
      registerModel({
        name: "solar-clearsky",
        version: "v1",
        status: "champion",
        metadata: { type: "forecast" },
        evaluation: { mae: 0.12, rmse: 0.18, bias: 0.03 },
        approvalOwner: "zolt-model-governance",
        environment: "development",
        trainingDatasetVersion: "synthetic-baseline-v1",
        featureSetVersion: "solar-baseline-v1",
        trainedAt: "2026-08-12T00:00:00.000Z",
        owner: "energy-intelligence",
        intendedUse: "Baseline comparison and pilot advisory forecasting",
        limitations: [
          "Not trained on production plant history",
          "Weather input is externally supplied",
        ],
        safetyThresholds: { maximumDrift: 0.2, maximumError: 0.3 },
      });
      registerModel({
        name: "inverter-health-zscore",
        version: "v1",
        status: "champion",
        metadata: { type: "anomaly" },
        evaluation: { precision: 0.7, recall: 0.6 },
        approvalOwner: "zolt-model-governance",
        environment: "development",
        trainingDatasetVersion: "synthetic-anomaly-v1",
        featureSetVersion: "inverter-health-v1",
        trainedAt: "2026-08-12T00:00:00.000Z",
        owner: "energy-intelligence",
        intendedUse: "Pilot advisory anomaly triage",
        limitations: ["Requires validation against labelled inverter failures"],
        safetyThresholds: { maximumDrift: 0.2, maximumError: 0.35 },
      });
      return listModels(undefined, tenantId);
    },
    optimise: async (input) => {
      const { optimiseSite } = await import("@zolt/optimisation");
      return optimiseSite({
        forecastKw: input.forecastKw ?? 0,
        exportLimitKw: input.exportLimitKw ?? 0,
        loadKw: input.loadKw ?? 0,
        batterySocPct: input.batterySocPct ?? 50,
        batteryPowerKw: input.batteryPowerKw ?? 0,
        hydrogenCapacityKgPerHour: input.hydrogenCapacityKgPerHour ?? 0,
        tariff: input.tariff ?? 0,
      });
    },
    billing: async (tenantId) => {
      const tenant = await database.prisma.tenant.findUnique({
        where: { id: tenantId },
      });
      return {
        tenantId,
        plan: tenant?.plan ?? "pilot",
        region: (tenant as { region?: string } | null)?.region ?? "af-south-1",
        slaAvailabilityTarget:
          (tenant as { slaAvailabilityTarget?: number } | null)
            ?.slaAvailabilityTarget ?? 0.995,
      };
    },
    exportTenant: database.exportTenantData,
    offboardTenant: database.offboardTenant,
    deleteTenant: database.deleteOffboardedTenant,
  };
  const app = buildApiApp(dependencies, { logger: true });
  await app.listen({
    port: Number(process.env.API_PORT ?? 4000),
    host: "0.0.0.0",
  });
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  startApiServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
