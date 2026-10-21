process.env.REDIS_URL = "";
process.env.ZOLT_ALLOW_INSECURE_AUTH ??= "true";
process.env.ZOLT_ADVISORY_ONLY ??= "true";
process.env.ZOLT_API_KEY ??= "dev-api-key-change-me";
process.env.ZOLT_INGEST_HMAC_SECRET ??= "dev-hmac-secret-change-me";
process.env.ZOLT_BOOTSTRAP_TENANT_ID ??= "tenant-demo";
process.env.ZOLT_BOOTSTRAP_PRODUCT_ID ??= "product-demo";
process.env.ZOLT_BOOTSTRAP_INSTALLATION_ID ??= "installation-demo";

import { assertSafeWebhookUrl } from "../packages/auth/src/ssrf.js";
import { buildApiApp } from "../apps/api/src/server.js";

const app = buildApiApp(
  {
    enqueueTelemetry: async () => undefined,
    listTelemetryForInstallation: async () => [],
    saveRecommendations: async () => undefined,
    listRecommendations: async () => [],
    updateRecommendationStatus: async () => undefined,
    writeAuditEvent: async () => undefined,
    readinessCheck: async () => true,
    createWebhook: async (input) => {
      await assertSafeWebhookUrl(input.url);
      return "webhook-harness";
    },
    createOrchestrator: () => ({
      analyse: async () => [],
    }),
  },
  { logger: false },
);

const port = Number(process.env.API_PORT ?? 4000);
await app.listen({ port, host: "127.0.0.1" });
process.stdout.write(`security-harness-api listening on ${port}\n`);
