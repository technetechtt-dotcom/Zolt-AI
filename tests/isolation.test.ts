import { afterEach, describe, expect, it } from "vitest";
import { buildApiApp, type ApiDependencies } from "../apps/api/src/server.js";
import { createTestTelemetryEnvelope } from "./helpers/fixtures.js";
import { setCredentialResolver } from "@zolt/auth";

function deps(): ApiDependencies {
  return {
    enqueueTelemetry: async () => undefined,
    listTelemetryForInstallation: async () => [],
    saveRecommendations: async () => undefined,
    listRecommendations: async () => [],
    updateRecommendationStatus: async () => undefined,
    writeAuditEvent: async () => undefined,
    readinessCheck: async () => true,
    createOrchestrator: () => ({ analyse: async () => [] }),
  };
}

describe("Tenant isolation", () => {
  afterEach(() => {
    delete process.env.ZOLT_API_KEY;
    delete process.env.ZOLT_BOOTSTRAP_TENANT_ID;
    setCredentialResolver(null);
  });

  it("rejects a manually supplied installation without user access", async () => {
    setCredentialResolver(async (key) =>
      key === "user-key"
        ? {
            tenantId: "tenant-1",
            userId: "user-1",
            permissions: ["telemetry:read"],
            actorType: "USER",
          }
        : null,
    );
    const dependencies = deps();
    dependencies.hasInstallationAccess = async () => false;
    const app = buildApiApp(dependencies, { logger: false });
    const response = await app.inject({
      method: "GET",
      url: "/v1/telemetry?tenantId=tenant-1&productId=product-1&installationId=installation-secret",
      headers: { "x-zolt-api-key": "user-key" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("INSTALLATION_ACCESS_DENIED");
    await app.close();
  });

  it("passes the tenant user scope into recommendation queries", async () => {
    setCredentialResolver(async () => ({
      tenantId: "tenant-1",
      userId: "user-1",
      permissions: ["recommendation:read"],
      actorType: "USER",
    }));
    let captured: Record<string, unknown> | undefined;
    const dependencies = deps();
    dependencies.listRecommendations = async (input) => {
      captured = input;
      return [];
    };
    const app = buildApiApp(dependencies, { logger: false });
    const response = await app.inject({
      method: "GET",
      url: "/v1/recommendations",
      headers: { "x-zolt-api-key": "user-key" },
    });
    expect(response.statusCode).toBe(200);
    expect(captured).toMatchObject({
      tenantId: "tenant-1",
      userId: "user-1",
      unrestricted: false,
    });
    await app.close();
  });

  it("rejects telemetry for a different tenant than the bound credential", async () => {
    process.env.ZOLT_API_KEY = "test-key";
    process.env.ZOLT_BOOTSTRAP_TENANT_ID = "tenant-1";
    const app = buildApiApp(deps(), { logger: false });
    const response = await app.inject({
      method: "POST",
      url: "/v1/telemetry",
      headers: { "x-zolt-api-key": "test-key" },
      payload: createTestTelemetryEnvelope({ tenantId: "other-tenant" }),
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
