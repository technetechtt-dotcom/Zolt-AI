import type { FastifyReply, FastifyRequest } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Redis } from "ioredis";

function safeCompare(value: string, expected: string): boolean {
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function requireApiKey(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const configured = process.env.ZOLT_API_KEY;
  const allowInsecure = process.env.ZOLT_ALLOW_INSECURE_AUTH === "true";
  if (!configured && allowInsecure) {
    return;
  }
  if (!configured) {
    await reply.code(503).send({ code: "AUTH_NOT_CONFIGURED" });
    return;
  }

  const provided = String(req.headers["x-zolt-api-key"] ?? "");
  if (!provided || !safeCompare(provided, configured)) {
    await reply.code(401).send({ code: "UNAUTHORIZED" });
    return;
  }
}

const replayCache = new Map<string, number>();
let replayRedis: Redis | null | undefined;

function pruneReplayCache(now: number): void {
  for (const [key, expiresAt] of replayCache.entries()) {
    if (expiresAt < now) {
      replayCache.delete(key);
    }
  }
}

function replayRedisClient(): Redis | null {
  if (replayRedis !== undefined) {
    return replayRedis;
  }
  if (!process.env.REDIS_URL) {
    replayRedis = null;
    return replayRedis;
  }

  replayRedis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null
  });
  return replayRedis;
}

async function claimReplayKey(key: string): Promise<boolean> {
  const redis = replayRedisClient();
  if (redis) {
    const result = await redis.set(`zolt:replay:${key}`, "1", "PX", 10 * 60 * 1000, "NX");
    return result === "OK";
  }

  const now = Date.now();
  pruneReplayCache(now);
  if (replayCache.has(key)) {
    return false;
  }
  replayCache.set(key, now + 10 * 60 * 1000);
  return true;
}

export async function requireSignedIngest(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const secret = process.env.ZOLT_INGEST_HMAC_SECRET;
  const allowInsecure = process.env.ZOLT_ALLOW_INSECURE_AUTH === "true";
  if (!secret && allowInsecure) {
    return;
  }
  if (!secret) {
    await reply.code(503).send({ code: "INGEST_SIGNATURE_NOT_CONFIGURED" });
    return;
  }

  const timestampHeader = String(req.headers["x-zolt-signature-ts"] ?? "");
  const signatureHeader = String(req.headers["x-zolt-signature"] ?? "");
  const replayKey = String(req.headers["x-zolt-replay-key"] ?? "");

  if (!timestampHeader || !signatureHeader || !replayKey) {
    await reply.code(401).send({ code: "MISSING_INGEST_SIGNATURE" });
    return;
  }

  const timestampMs = Number(timestampHeader);
  if (!Number.isFinite(timestampMs)) {
    await reply.code(401).send({ code: "INVALID_INGEST_SIGNATURE" });
    return;
  }

  const now = Date.now();
  const skewMs = Math.abs(now - timestampMs);
  if (skewMs > 5 * 60 * 1000) {
    await reply.code(401).send({ code: "SIGNATURE_EXPIRED" });
    return;
  }

  if (process.env.NODE_ENV === "production" && !process.env.REDIS_URL) {
    await reply.code(503).send({ code: "REPLAY_STORE_NOT_CONFIGURED" });
    return;
  }

  const claimed = await claimReplayKey(replayKey);
  if (!claimed) {
    await reply.code(409).send({ code: "REPLAY_DETECTED" });
    return;
  }

  const body = JSON.stringify(req.body ?? {});
  const expected = createHmac("sha256", secret)
    .update(`${timestampHeader}.${replayKey}.${body}`)
    .digest("hex");

  if (!safeCompare(signatureHeader, expected)) {
    await reply.code(401).send({ code: "INVALID_INGEST_SIGNATURE" });
    return;
  }
}
