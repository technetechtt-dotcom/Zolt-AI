import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
    saveTelemetryEnvelope: vi.fn(async () => undefined),
    enqueueTelemetry: vi.fn(async () => undefined),
    forwardToApi: vi.fn(async () => undefined)
  };
}

afterEach(() => {
  delete process.env.ZOLT_API_KEY;
  delete process.env.ZOLT_INGEST_HMAC_SECRET;
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

  it("ingests valid payload and persists + enqueues telemetry", async () => {
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
    expect(deps.saveTelemetryEnvelope).toHaveBeenCalledTimes(1);
    expect(deps.forwardToApi).toHaveBeenCalledTimes(1);
    expect(deps.enqueueTelemetry).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("still accepts ingest when API forwarding fails", async () => {
    const deps = createGatewayDependencies();
    deps.forwardToApi = vi.fn(async () => {
      throw new Error("API unavailable");
    });
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

    expect(response.statusCode).toBe(202);
    expect(deps.saveTelemetryEnvelope).toHaveBeenCalledTimes(1);
    expect(deps.enqueueTelemetry).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
