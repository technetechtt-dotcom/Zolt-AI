import { afterEach, describe, expect, it } from "vitest";
import { buildApiApp, type ApiDependencies } from "../apps/api/src/server.js";
import { createTestTelemetryEnvelope } from "./helpers/fixtures.js";

function deps(): ApiDependencies {
  return {
    enqueueTelemetry: async () => undefined,
    listTelemetryForInstallation: async () => [],
    saveRecommendations: async () => undefined,
    listRecommendations: async () => [],
    updateRecommendationStatus: async () => undefined,
    writeAuditEvent: async () => undefined,
    readinessCheck: async () => true,
    createOrchestrator: () => ({ analyse: async () => [] })
  };
}

describe("Tenant isolation", () => {
  afterEach(() => {
    delete process.env.ZOLT_API_KEY;
    delete process.env.ZOLT_BOOTSTRAP_TENANT_ID;
  });

  it("rejects telemetry for a different tenant than the bound credential", async () => {
    process.env.ZOLT_API_KEY = "test-key";
    process.env.ZOLT_BOOTSTRAP_TENANT_ID = "tenant-1";
    const app = buildApiApp(deps(), { logger: false });
    const response = await app.inject({
      method: "POST",
      url: "/v1/telemetry",
      headers: { "x-zolt-api-key": "test-key" },
      payload: createTestTelemetryEnvelope({ tenantId: "other-tenant" })
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
