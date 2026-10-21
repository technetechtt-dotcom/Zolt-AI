process.env.REDIS_URL = "";
process.env.ZOLT_ALLOW_INSECURE_AUTH ??= "true";
process.env.ZOLT_ADVISORY_ONLY ??= "true";
process.env.ZOLT_API_KEY ??= "dev-api-key-change-me";
process.env.ZOLT_INGEST_HMAC_SECRET ??= "dev-hmac-secret-change-me";

import { buildGatewayApp } from "../apps/connector-gateway/src/server.js";
import { GridFlexConnector } from "../connectors/gridflex/src/index.js";

const accepted = { count: 0 };

const app = buildGatewayApp(
  {
    connector: new GridFlexConnector(),
    enqueueTelemetry: async () => {
      accepted.count += 1;
    },
    verifyTenantAccess: async (identity) => identity,
    readinessCheck: async () => true,
  },
  { logger: false },
);

app.get("/harness", async () => ({ accepted: accepted.count, advisoryOnly: true }));

const port = Number(process.env.CONNECTOR_GATEWAY_PORT ?? 4001);
await app.listen({ port, host: "127.0.0.1" });
process.stdout.write(`load-harness-gateway listening on ${port}\n`);
