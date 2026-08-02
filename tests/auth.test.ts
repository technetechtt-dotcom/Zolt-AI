import { createHmac } from "node:crypto";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { requireApiKey, requireSignedIngest } from "../packages/auth/src/index.js";

describe("Auth middleware", () => {
  afterEach(() => {
    delete process.env.ZOLT_API_KEY;
    delete process.env.ZOLT_INGEST_HMAC_SECRET;
  });

  it("rejects requests with wrong API key", async () => {
    process.env.ZOLT_API_KEY = "secret-key";
    const app = Fastify();
    app.post("/secure", { preHandler: requireApiKey }, async () => ({ ok: true }));

    const response = await app.inject({
      method: "POST",
      url: "/secure",
      headers: {
        "x-zolt-api-key": "wrong"
      }
    });

    expect(response.statusCode).toBe(401);
  });

  it("accepts valid signed ingest requests", async () => {
    process.env.ZOLT_INGEST_HMAC_SECRET = "signing-secret";
    const app = Fastify();
    app.post("/ingest", { preHandler: requireSignedIngest }, async () => ({ ok: true }));

    const body = {
      messageId: "m-1",
      value: 42
    };
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
        "x-zolt-signature": signature
      }
    });

    expect(response.statusCode).toBe(200);
  });

  it("blocks replayed signed ingest requests", async () => {
    process.env.ZOLT_INGEST_HMAC_SECRET = "signing-secret";
    const app = Fastify();
    app.post("/ingest", { preHandler: requireSignedIngest }, async () => ({ ok: true }));

    const body = {
      messageId: "m-2",
      value: 99
    };
    const timestamp = Date.now().toString();
    const replayKey = "replay-b";
    const signature = createHmac("sha256", process.env.ZOLT_INGEST_HMAC_SECRET)
      .update(`${timestamp}.${replayKey}.${JSON.stringify(body)}`)
      .digest("hex");

    await app.inject({
      method: "POST",
      url: "/ingest",
      payload: body,
      headers: {
        "x-zolt-signature-ts": timestamp,
        "x-zolt-replay-key": replayKey,
        "x-zolt-signature": signature
      }
    });

    const replayed = await app.inject({
      method: "POST",
      url: "/ingest",
      payload: body,
      headers: {
        "x-zolt-signature-ts": timestamp,
        "x-zolt-replay-key": replayKey,
        "x-zolt-signature": signature
      }
    });

    expect(replayed.statusCode).toBe(409);
  });
});
