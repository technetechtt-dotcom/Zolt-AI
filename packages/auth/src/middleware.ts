import type { FastifyReply, FastifyRequest } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";

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
  if (!configured) {
    return;
  }

  const provided = String(req.headers["x-zolt-api-key"] ?? "");
  if (!provided || !safeCompare(provided, configured)) {
    await reply.code(401).send({ code: "UNAUTHORIZED" });
    return;
  }
}

const replayCache = new Map<string, number>();

function pruneReplayCache(now: number): void {
  for (const [key, expiresAt] of replayCache.entries()) {
    if (expiresAt < now) {
      replayCache.delete(key);
    }
  }
}

export async function requireSignedIngest(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const secret = process.env.ZOLT_INGEST_HMAC_SECRET;
  if (!secret) {
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

  pruneReplayCache(now);
  if (replayCache.has(replayKey)) {
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

  replayCache.set(replayKey, now + 10 * 60 * 1000);
}
