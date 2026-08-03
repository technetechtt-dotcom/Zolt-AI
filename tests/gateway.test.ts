import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ZoltTelemetryEnvelope } from "../packages/contracts/src/index.js";
import type { GatewayDependencies } from "../apps/connector-gateway/src/server.js";
import { createTestTelemetryEnvelope } from "./helpers/fixtures.js";

vi.mock("@zolt/database", () => ({
  saveTelemetryEnvelope: vi.fn(async () => undefined)
}));

vi.mock("@zolt/queue", () => ({
  enqueueTelemetry: vi.fn(async () => undefined)
}));

let buildGatewayApp: (deps: GatewayDependencies, options?: { logger?: boolean }) => any;

beforeAll(async () => {
  const module = await import("../apps/connector-gateway/src/server.js");
  buildGatewayApp = module.buildGatewayApp;
});

afterAll(() => {
  vi.restoreAllMocks();
});

function createGatewayDependencies(): GatewayDependencies {
  return {
    connector: {
      validatePayload: vi.fn(() => ({ valid: true, errors: [] })),
      transform: vi.fn(async () => {
        const message: ZoltTelemetryEnvelope = createTestTelemetryEnvelope({
          messageId: "gw-message-1"
        });
        return [message];
      })
    } as GatewayDependencies["connector"],
    enqueueTelemetry: vi.fn(async () => undefined),
    verifyTenantAccess: vi.fn(async () => true),
    readinessCheck: vi.fn(async () => true)
  };
}

beforeEach(() => {
  process.env.ZOLT_ALLOW_INSECURE_AUTH = "true";
});

afterEach(() => {
  delete process.env.ZOLT_API_KEY;
  delete process.env.ZOLT_INGEST_HMAC_SECRET;
  delete process.env.ZOLT_ALLOW_INSECURE_AUTH;
});

describe("Gateway routes", () => {
  it("returns 401 when identity headers are missing", async () => {
    const deps = createGatewayDependencies();
    const app = buildGatewayApp(deps, { logger: false });

    const response = await app.inject({
      method: "POST",
      url: "/v1/ingest/gridflex",
      payload: { messageId: "m", nodeId: "n", timestamp: new Date().toISOString(), readings: {} }
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("returns 400 for invalid connector payload", async () => {
    const deps = createGatewayDependencies();
    deps.connector.validatePayload = vi.fn(() => ({ valid: false, errors: ["bad payload"] }));
    const app = buildGatewayApp(deps, { logger: false });

    const response = await app.inject({
      method: "POST",
      url: "/v1/ingest/gridflex",
      headers: {
        "x-zolt-tenant-id": "tenant-1",
        "x-zolt-product-id": "product-1",
        "x-zolt-installation-id": "installation-1"
      },
      payload: { any: "value" }
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("ingests valid payload and enqueues telemetry", async () => {
    const deps = createGatewayDependencies();
    const app = buildGatewayApp(deps, { logger: false });

    const response = await app.inject({
      method: "POST",
      url: "/v1/ingest/gridflex",
      headers: {
        "x-zolt-tenant-id": "tenant-1",
        "x-zolt-product-id": "product-1",
        "x-zolt-installation-id": "installation-1"
      },
      payload: {
        messageId: "m-good",
        nodeId: "node-1",
        timestamp: new Date().toISOString(),
        readings: { powerKw: 123.4 }
      }
    });

    expect(response.statusCode).toBe(202);
    expect(deps.enqueueTelemetry).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("rejects unauthorized tenant identity", async () => {
    const deps = createGatewayDependencies();
    deps.verifyTenantAccess = vi.fn(async () => false);
    const app = buildGatewayApp(deps, { logger: false });

    const response = await app.inject({
      method: "POST",
      url: "/v1/ingest/gridflex",
      headers: {
        "x-zolt-tenant-id": "tenant-1",
        "x-zolt-product-id": "product-1",
        "x-zolt-installation-id": "installation-1"
      },
      payload: {
        messageId: "m-resilient",
        nodeId: "node-1",
        timestamp: new Date().toISOString(),
        readings: { powerKw: 99.1 }
      }
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
