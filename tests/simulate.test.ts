import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ApiDependencies } from "../apps/api/src/server.js";
import { setCredentialResolver } from "@zolt/auth";

let buildApiApp: (deps: ApiDependencies, options?: { logger?: boolean }) => any;

beforeAll(async () => {
  const module = await import("../apps/api/src/server.js");
  buildApiApp = module.buildApiApp;
});

afterEach(() => {
  setCredentialResolver(null);
  delete process.env.ZOLT_API_KEY;
});

describe("advisory simulate loop", () => {
  it("simulates a plan without plant execution", async () => {
    process.env.ZOLT_API_KEY = "test-key";
    setCredentialResolver(async () => ({
      tenantId: "tenant-1",
      permissions: ["recommendation:read"],
      actorType: "USER",
    }));
    const deps: ApiDependencies = {
      enqueueTelemetry: vi.fn(async () => undefined),
      listTelemetryForInstallation: vi.fn(async () => []),
      saveRecommendations: vi.fn(async () => undefined),
      listRecommendations: vi.fn(async () => []),
      updateRecommendationStatus: vi.fn(async () => undefined),
      writeAuditEvent: vi.fn(async () => undefined),
      readinessCheck: vi.fn(async () => true),
      createOrchestrator: () => ({ analyse: vi.fn(async () => []) }),
      optimise: vi.fn(async () => ({
        advisoryOnly: true,
        recoveredEnergyKwh: 12,
      })),
    };
    const app = buildApiApp(deps, { logger: false });
    const response = await app.inject({
      method: "POST",
      url: "/v1/simulate",
      headers: { "x-zolt-api-key": "test-key" },
      payload: { forecastKw: 100, exportLimitKw: 50, loadKw: 20 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      plantExecution: false,
      humanApprovalRequired: true,
      advisoryOnly: true,
    });
    await app.close();
  });
});
