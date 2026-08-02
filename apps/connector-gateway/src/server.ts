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
  saveTelemetryEnvelope: (message: ZoltTelemetryEnvelope) => Promise<void>;
  enqueueTelemetry: (message: ZoltTelemetryEnvelope) => Promise<void>;
  forwardToApi: (message: ZoltTelemetryEnvelope) => Promise<void>;
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
        await dependencies.saveTelemetryEnvelope(message);

        try {
          await dependencies.forwardToApi(message);
        } catch {
          // API may not be available in all deployment modes.
        }

        await dependencies.enqueueTelemetry(message);
      }

      return reply.code(202).send({ accepted: messages.length });
    }
  );

  return app;
}

export async function startGatewayServer(): Promise<void> {
  const [{ GridFlexConnector }, database, queue] = await Promise.all([
    import("@zolt/connector-gridflex"),
    import("@zolt/database"),
    import("@zolt/queue")
  ]);

  const dependencies: GatewayDependencies = {
    connector: new GridFlexConnector(),
    saveTelemetryEnvelope: database.saveTelemetryEnvelope,
    enqueueTelemetry: queue.enqueueTelemetry,
    forwardToApi: async (message) => {
      const apiBaseUrl = process.env.ZOLT_API_BASE_URL ?? "http://localhost:4000";
      await fetch(`${apiBaseUrl}/v1/telemetry`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-zolt-api-key": process.env.ZOLT_API_KEY ?? ""
        },
        body: JSON.stringify(message)
      });
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
