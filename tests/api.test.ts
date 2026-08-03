import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ZoltRecommendation, ZoltTelemetryEnvelope } from "../packages/contracts/src/index.js";
import type { ApiDependencies } from "../apps/api/src/server.js";
import { createTestRecommendation, createTestTelemetryEnvelope } from "./helpers/fixtures.js";

vi.mock("@zolt/database", () => ({
  listRecommendations: vi.fn(async () => []),
  listTelemetryForInstallation: vi.fn(async () => []),
  saveRecommendations: vi.fn(async () => undefined),
  updateRecommendationStatus: vi.fn(async () => undefined),
  writeAuditEvent: vi.fn(async () => undefined)
}));

vi.mock("@zolt/queue", () => ({
  enqueueTelemetry: vi.fn(async () => undefined),
  telemetryQueue: vi.fn(() => ({
    waitUntilReady: vi.fn(async () => undefined)
  }))
}));

let buildApiApp: (deps: ApiDependencies, options?: { logger?: boolean }) => any;

beforeAll(async () => {
  const module = await import("../apps/api/src/server.js");
  buildApiApp = module.buildApiApp;
});

afterAll(() => {
  vi.restoreAllMocks();
});

function createDependencies(): ApiDependencies {
  return {
    enqueueTelemetry: vi.fn(async () => undefined),
    listTelemetryForInstallation: vi.fn(async () => []),
    saveRecommendations: vi.fn(async () => undefined),
    listRecommendations: vi.fn(async () => []),
    updateRecommendationStatus: vi.fn(async () => undefined),
    writeAuditEvent: vi.fn(async () => undefined),
    readinessCheck: vi.fn(async () => true),
    createOrchestrator: () => ({
      analyse: vi.fn(async () => [] as ZoltRecommendation[])
    })
  };
}

afterEach(() => {
  delete process.env.ZOLT_API_KEY;
  delete process.env.ZOLT_ADVISORY_ONLY;
});

describe("API routes", () => {
  it("accepts telemetry payload and writes audit", async () => {
    process.env.ZOLT_API_KEY = "test-key";
    const deps = createDependencies();
    const app = buildApiApp(deps, { logger: false });

    const response = await app.inject({
      method: "POST",
      url: "/v1/telemetry",
      headers: {
        "x-zolt-api-key": "test-key"
      },
      payload: createTestTelemetryEnvelope()
    });

    expect(response.statusCode).toBe(202);
    expect(deps.enqueueTelemetry).toHaveBeenCalledTimes(1);
    expect(deps.writeAuditEvent).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("rejects invalid analysis requests", async () => {
    process.env.ZOLT_API_KEY = "test-key";
    const deps = createDependencies();
    const app = buildApiApp(deps, { logger: false });

    const response = await app.inject({
      method: "POST",
      url: "/v1/analysis",
      headers: {
        "x-zolt-api-key": "test-key"
      },
      payload: { tenantId: "tenant-1" }
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("returns analysis recommendations and persists them", async () => {
    process.env.ZOLT_API_KEY = "test-key";
    process.env.ZOLT_ADVISORY_ONLY = "true";

    const recommendation = createTestRecommendation();
    const analyse = vi.fn(async () => [recommendation] as ZoltRecommendation[]);
    const deps = createDependencies();
    deps.listTelemetryForInstallation = vi.fn(async () => [createTestTelemetryEnvelope()]);
    deps.createOrchestrator = () => ({ analyse });
    const app = buildApiApp(deps, { logger: false });

    const response = await app.inject({
      method: "POST",
      url: "/v1/analysis",
      headers: {
        "x-zolt-api-key": "test-key"
      },
      payload: {
        tenantId: "tenant-1",
        productId: "product-1",
        installationId: "installation-1",
        configuration: {
          exportLimitKw: 120,
          forecastPowerKw: 150
        }
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { advisoryOnly: boolean; recommendations: ZoltRecommendation[] };
    expect(body.advisoryOnly).toBe(true);
    expect(body.recommendations).toHaveLength(1);
    expect(body.recommendations[0]?.id).toBe("rec-1");
    expect(analyse).toHaveBeenCalledTimes(1);
    expect(deps.saveRecommendations).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("returns 400 when recommendations tenant is missing", async () => {
    process.env.ZOLT_API_KEY = "test-key";
    const deps = createDependencies();
    const app = buildApiApp(deps, { logger: false });

    const response = await app.inject({
      method: "GET",
      url: "/v1/recommendations",
      headers: {
        "x-zolt-api-key": "test-key"
      }
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("maps transition errors to 409", async () => {
    process.env.ZOLT_API_KEY = "test-key";
    const deps = createDependencies();
    deps.updateRecommendationStatus = vi.fn(async () => {
      throw new Error("INVALID_RECOMMENDATION_TRANSITION:PROPOSED->RESOLVED");
    });
    const app = buildApiApp(deps, { logger: false });

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/recommendations/rec-1/status",
      headers: {
        "x-zolt-api-key": "test-key"
      },
      payload: {
        tenantId: "tenant-1",
        status: "RESOLVED"
      }
    });

    expect(response.statusCode).toBe(409);
    await app.close();
  });

  it("returns 409 when advisory policy is disabled", async () => {
    process.env.ZOLT_API_KEY = "test-key";
    process.env.ZOLT_ADVISORY_ONLY = "false";
    const deps = createDependencies();
    const app = buildApiApp(deps, { logger: false });

    const response = await app.inject({
      method: "POST",
      url: "/v1/analysis",
      headers: {
        "x-zolt-api-key": "test-key"
      },
      payload: {
        tenantId: "tenant-1",
        productId: "product-1",
        installationId: "installation-1"
      }
    });

    expect(response.statusCode).toBe(409);
    await app.close();
  });
});
