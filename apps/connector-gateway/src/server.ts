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
  requireSignedIngest,
  setCredentialResolver
} from "@zolt/auth";
import type { ZoltTelemetryEnvelope } from "@zolt/contracts";
import { MAX_TELEMETRY_BATCH } from "@zolt/contracts";
import { validateTelemetryEnvelope } from "@zolt/core";

interface ConnectorContext {
  tenantId: string;
  productId: string;
  installationId: string;
  receivedAt: string;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface GatewayDependencies {
  connector: {
    validatePayload: (payload: unknown) => ValidationResult;
    transform: (payload: unknown, context: ConnectorContext) => Promise<ZoltTelemetryEnvelope[]>;
  };
  enqueueTelemetry: (message: ZoltTelemetryEnvelope) => Promise<void>;
  verifyTenantAccess: (identity: {
    tenantId: string;
    productId: string;
    installationId: string;
  }) => Promise<boolean>;
  readinessCheck: () => Promise<boolean>;
}

export interface GatewayAppOptions {
  logger?: boolean;
}

export function buildGatewayApp(dependencies: GatewayDependencies, options: GatewayAppOptions = {}) {
  const loggerEnabled = options.logger ?? !process.env.VITEST;
  const app = Fastify({
    logger: loggerEnabled,
    bodyLimit: bodyLimitBytes(),
    trustProxy: process.env.ZOLT_TRUST_PROXY === "true"
  });
  applySecurityHeaders(app);

  app.get("/health/live", async () => ({ status: "ok", service: "zolt-connector-gateway" }));
  app.get("/health/ready", async (_req, reply) => {
    const ready = await dependencies.readinessCheck();
    if (!ready) {
      return reply.code(503).send({ status: "degraded", service: "zolt-connector-gateway" });
    }
    return { status: "ok", service: "zolt-connector-gateway" };
  });

  app.post(
    "/v1/ingest/gridflex",
    { preHandler: [requireApiKey, requirePermission("telemetry:write"), requireSignedIngest] },
    async (req, reply) => {
      const h = req.headers;
      const tenantId = String(h["x-zolt-tenant-id"] ?? req.zoltAuth?.tenantId ?? "");
      const productId = String(h["x-zolt-product-id"] ?? req.zoltAuth?.productId ?? "");
      const installationId = String(h["x-zolt-installation-id"] ?? req.zoltAuth?.installationId ?? "");
      if (!tenantId || !productId || !installationId) {
        return reply.code(401).send({ code: "MISSING_INTEGRATION_IDENTITY" });
      }
      try {
        if (req.zoltAuth) {
          assertIdentityBinding(req.zoltAuth, { tenantId, productId, installationId });
        }
      } catch {
        return reply.code(403).send({ code: "TENANT_MISMATCH" });
      }

      const authorized = await dependencies.verifyTenantAccess({ tenantId, productId, installationId });
      if (!authorized) {
        return reply.code(403).send({ code: "TENANT_ACCESS_DENIED" });
      }

      const validation = dependencies.connector.validatePayload(req.body);
      if (!validation.valid) {
        return reply.code(400).send({ code: "INVALID_CONNECTOR_PAYLOAD", errors: validation.errors });
      }

      const messages = await dependencies.connector.transform(req.body, {
        tenantId,
        productId,
        installationId,
        receivedAt: new Date().toISOString()
      });
      if (messages.length > MAX_TELEMETRY_BATCH) {
        return reply.code(413).send({ code: "TELEMETRY_BATCH_TOO_LARGE" });
      }

      for (const message of messages) {
        const checked = validateTelemetryEnvelope(message);
        if (checked.errors.length > 0 || !checked.envelope) {
          return reply.code(400).send({ code: "INVALID_TELEMETRY", errors: checked.errors });
        }
        await dependencies.enqueueTelemetry(checked.envelope);
      }

      return reply.code(202).send({ accepted: messages.length });
    }
  );

  return app;
}

export async function startGatewayServer(): Promise<void> {
  assertTlsIfProduction();
  const [{ GridFlexConnector }, queue, database] = await Promise.all([
    import("@zolt/connector-gridflex"),
    import("@zolt/queue"),
    import("@zolt/database")
  ]);
  setCredentialResolver(database.resolveApiCredential);

  const dependencies: GatewayDependencies = {
    connector: new GridFlexConnector(),
    enqueueTelemetry: queue.enqueueTelemetry,
    verifyTenantAccess: async (identity) => {
      try {
        await database.resolveInstallationIdentity({
          tenantKey: identity.tenantId,
          productKey: identity.productId,
          installationKey: identity.installationId
        });
        return true;
      } catch {
        return false;
      }
    },
    readinessCheck: async () => {
      try {
        await queue.telemetryQueue().waitUntilReady();
        return true;
      } catch {
        return false;
      }
    }
  };

  const app = buildGatewayApp(dependencies, { logger: true });
  await app.listen({ port: Number(process.env.CONNECTOR_GATEWAY_PORT ?? 4001), host: "0.0.0.0" });
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  startGatewayServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
