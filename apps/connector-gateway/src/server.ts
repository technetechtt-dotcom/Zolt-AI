import "dotenv/config";
import Fastify from "fastify";
import { fileURLToPath } from "node:url";
import { requireApiKey, requireSignedIngest } from "@zolt/auth";
import type { ZoltTelemetryEnvelope } from "@zolt/contracts";

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

export function buildGatewayApp(
  dependencies: GatewayDependencies,
  options: GatewayAppOptions = {}
) {
  const loggerEnabled = options.logger ?? !process.env.VITEST;
  const app = Fastify({ logger: loggerEnabled });

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
    { preHandler: [requireApiKey, requireSignedIngest] },
    async (req, reply) => {
      const h = req.headers;
      const tenantId = String(h["x-zolt-tenant-id"] ?? "");
      const productId = String(h["x-zolt-product-id"] ?? "");
      const installationId = String(h["x-zolt-installation-id"] ?? "");
      if (!tenantId || !productId || !installationId) {
        return reply.code(401).send({ code: "MISSING_INTEGRATION_IDENTITY" });
      }

      const authorized = await dependencies.verifyTenantAccess({
        tenantId,
        productId,
        installationId
      });
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

      for (const message of messages) {
        await dependencies.enqueueTelemetry(message);
      }

      return reply.code(202).send({ accepted: messages.length });
    }
  );

  return app;
}

export async function startGatewayServer(): Promise<void> {
  const [{ GridFlexConnector }, queue] = await Promise.all([
    import("@zolt/connector-gridflex"),
    import("@zolt/queue")
  ]);

  const allowed = new Set(
    String(process.env.ZOLT_ALLOWED_INSTALLATIONS ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
  );

  const dependencies: GatewayDependencies = {
    connector: new GridFlexConnector(),
    enqueueTelemetry: queue.enqueueTelemetry,
    verifyTenantAccess: async (identity) => {
      if (allowed.size === 0) {
        return process.env.NODE_ENV !== "production";
      }
      const key = `${identity.tenantId}:${identity.productId}:${identity.installationId}`;
      return allowed.has(key);
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
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}
