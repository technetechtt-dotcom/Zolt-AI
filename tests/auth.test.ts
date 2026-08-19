import { createHmac } from "node:crypto";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  requireApiKey,
  requirePermission,
  requireSignedIngest,
  setCredentialResolver,
} from "../packages/auth/src/index.js";
import { assertIdentityBinding } from "../packages/auth/src/principal.js";
import { ROLE_PERMISSIONS } from "../packages/contracts/src/index.js";

describe("Auth middleware", () => {
  afterEach(() => {
    delete process.env.ZOLT_API_KEY;
    delete process.env.ZOLT_INGEST_HMAC_SECRET;
    delete process.env.ZOLT_ALLOW_INSECURE_AUTH;
    delete process.env.ZOLT_BOOTSTRAP_TENANT_ID;
    delete process.env.ZOLT_ALLOW_ENV_BOOTSTRAP;
    delete process.env.NODE_ENV;
    setCredentialResolver(null);
  });

  it("fails closed when API key is not configured", async () => {
    const app = Fastify();
    app.post("/secure", { preHandler: requireApiKey }, async () => ({
      ok: true,
    }));
    const response = await app.inject({ method: "POST", url: "/secure" });
    expect(response.statusCode).toBe(503);
  });

  it("rejects requests with wrong API key", async () => {
    process.env.ZOLT_API_KEY = "secret-key";
    const app = Fastify();
    app.post("/secure", { preHandler: requireApiKey }, async () => ({
      ok: true,
    }));
    const response = await app.inject({
      method: "POST",
      url: "/secure",
      headers: { "x-zolt-api-key": "wrong" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("accepts valid signed ingest requests", async () => {
    process.env.ZOLT_INGEST_HMAC_SECRET = "signing-secret";
    const app = Fastify();
    app.post("/ingest", { preHandler: requireSignedIngest }, async () => ({
      ok: true,
    }));
    const body = { messageId: "m-1", value: 42 };
    const timestamp = Date.now().toString();
    const replayKey = "replay-a";
    const signature = createHmac("sha256", process.env.ZOLT_INGEST_HMAC_SECRET)
      .update(`${timestamp}.${replayKey}.${JSON.stringify(body)}`)
      .digest("hex");
    const response = await app.inject({
      method: "POST",
      url: "/ingest",
      payload: body,
      headers: {
        "x-zolt-signature-ts": timestamp,
        "x-zolt-replay-key": replayKey,
        "x-zolt-signature": signature,
      },
    });
    expect(response.statusCode).toBe(200);
  });

  it("rejects HMAC tampering before claiming the replay key", async () => {
    process.env.ZOLT_INGEST_HMAC_SECRET = "signing-secret";
    const app = Fastify();
    app.post("/ingest", { preHandler: requireSignedIngest }, async () => ({
      ok: true,
    }));
    const body = { messageId: "m-tamper", value: 1 };
    const timestamp = Date.now().toString();
    const replayKey = "replay-tamper";
    const response = await app.inject({
      method: "POST",
      url: "/ingest",
      payload: body,
      headers: {
        "x-zolt-signature-ts": timestamp,
        "x-zolt-replay-key": replayKey,
        "x-zolt-signature": "deadbeef",
      },
    });
    expect(response.statusCode).toBe(401);
    const valid = createHmac("sha256", process.env.ZOLT_INGEST_HMAC_SECRET)
      .update(`${timestamp}.${replayKey}.${JSON.stringify(body)}`)
      .digest("hex");
    const retry = await app.inject({
      method: "POST",
      url: "/ingest",
      payload: body,
      headers: {
        "x-zolt-signature-ts": timestamp,
        "x-zolt-replay-key": replayKey,
        "x-zolt-signature": valid,
      },
    });
    expect(retry.statusCode).toBe(200);
  });

  it("rejects expired timestamps", async () => {
    process.env.ZOLT_INGEST_HMAC_SECRET = "signing-secret";
    const app = Fastify();
    app.post("/ingest", { preHandler: requireSignedIngest }, async () => ({
      ok: true,
    }));
    const body = { messageId: "m-old" };
    const timestamp = (Date.now() - 10 * 60 * 1000).toString();
    const replayKey = "replay-old";
    const signature = createHmac("sha256", process.env.ZOLT_INGEST_HMAC_SECRET)
      .update(`${timestamp}.${replayKey}.${JSON.stringify(body)}`)
      .digest("hex");
    const response = await app.inject({
      method: "POST",
      url: "/ingest",
      payload: body,
      headers: {
        "x-zolt-signature-ts": timestamp,
        "x-zolt-replay-key": replayKey,
        "x-zolt-signature": signature,
      },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("SIGNATURE_EXPIRED");
  });

  it("fails closed when ingest secret is not configured", async () => {
    const app = Fastify();
    app.post("/ingest", { preHandler: requireSignedIngest }, async () => ({
      ok: true,
    }));
    const response = await app.inject({
      method: "POST",
      url: "/ingest",
      payload: { foo: "bar" },
    });
    expect(response.statusCode).toBe(503);
  });

  it("blocks replayed signed ingest requests", async () => {
    process.env.ZOLT_INGEST_HMAC_SECRET = "signing-secret";
    const app = Fastify();
    app.post("/ingest", { preHandler: requireSignedIngest }, async () => ({
      ok: true,
    }));
    const body = { messageId: "m-2", value: 99 };
    const timestamp = Date.now().toString();
    const replayKey = "replay-b";
    const signature = createHmac("sha256", process.env.ZOLT_INGEST_HMAC_SECRET)
      .update(`${timestamp}.${replayKey}.${JSON.stringify(body)}`)
      .digest("hex");
    const headers = {
      "x-zolt-signature-ts": timestamp,
      "x-zolt-replay-key": replayKey,
      "x-zolt-signature": signature,
    };
    await app.inject({
      method: "POST",
      url: "/ingest",
      payload: body,
      headers,
    });
    const replayed = await app.inject({
      method: "POST",
      url: "/ingest",
      payload: body,
      headers,
    });
    expect(replayed.statusCode).toBe(409);
  });

  it("allows insecure auth when explicitly enabled", async () => {
    process.env.ZOLT_ALLOW_INSECURE_AUTH = "true";
    const app = Fastify();
    app.post("/secure", { preHandler: requireApiKey }, async () => ({
      ok: true,
    }));
    const response = await app.inject({ method: "POST", url: "/secure" });
    expect(response.statusCode).toBe(200);
  });

  it("enforces RBAC permissions", async () => {
    process.env.ZOLT_API_KEY = "secret-key";
    const app = Fastify();
    app.get(
      "/audit",
      { preHandler: [requireApiKey, requirePermission("audit:read")] },
      async () => ({ ok: true }),
    );
    const response = await app.inject({
      method: "GET",
      url: "/audit",
      headers: { "x-zolt-api-key": "secret-key" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("blocks cross-tenant identity binding", () => {
    expect(() =>
      assertIdentityBinding(
        {
          tenantId: "tenant-a",
          permissions: ROLE_PERMISSIONS["api-integration"],
          actorType: "API",
        },
        { tenantId: "tenant-b" },
      ),
    ).toThrow("TENANT_MISMATCH");
  });

  it("never accepts an environment bootstrap API key in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.ZOLT_API_KEY = "production-bootstrap-key";
    process.env.ZOLT_ALLOW_ENV_BOOTSTRAP = "true";
    process.env.ZOLT_BOOTSTRAP_TENANT_ID = "tenant-a";
    setCredentialResolver(async () => null);
    const app = Fastify();
    app.get("/secure", { preHandler: requireApiKey }, async () => ({
      ok: true,
    }));
    const response = await app.inject({
      method: "GET",
      url: "/secure",
      headers: { "x-zolt-api-key": "production-bootstrap-key" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("never permits insecure authentication in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.ZOLT_ALLOW_INSECURE_AUTH = "true";
    const app = Fastify();
    app.get("/secure", { preHandler: requireApiKey }, async () => ({
      ok: true,
    }));
    const response = await app.inject({ method: "GET", url: "/secure" });
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe("INSECURE_AUTH_FORBIDDEN_IN_PRODUCTION");
  });
});
