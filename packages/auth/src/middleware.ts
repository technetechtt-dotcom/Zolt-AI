import type { FastifyReply, FastifyRequest } from "fastify";
import { createHmac } from "node:crypto";
import { Redis } from "ioredis";
import type { PermissionKey } from "@zolt/contracts";
import { ROLE_PERMISSIONS } from "@zolt/contracts";
import { allowInsecureAuth, isProduction, safeCompare, verifySecret } from "./crypto.js";
import type { AuthenticatedPrincipal } from "./principal.js";
import { clientIp, enforceRateLimit } from "./rate-limit.js";

declare module "fastify" {
  interface FastifyRequest {
    zoltAuth?: AuthenticatedPrincipal;
  }
}

export type CredentialResolver = (plaintext: string) => Promise<AuthenticatedPrincipal | null>;
export type SessionResolver = (token: string) => Promise<AuthenticatedPrincipal | null>;

let credentialResolver: CredentialResolver | null = null;
let sessionResolver: SessionResolver | null = null;

export function setCredentialResolver(resolver: CredentialResolver | null): void {
  credentialResolver = resolver;
}

export function setSessionResolver(resolver: SessionResolver | null): void {
  sessionResolver = resolver;
}

function bootstrapPrincipal(): AuthenticatedPrincipal | null {
  const tenantId = process.env.ZOLT_BOOTSTRAP_TENANT_ID;
  if (!tenantId) {
    return null;
  }
  return {
    tenantId,
    productId: process.env.ZOLT_BOOTSTRAP_PRODUCT_ID,
    installationId: process.env.ZOLT_BOOTSTRAP_INSTALLATION_ID,
    permissions: ROLE_PERMISSIONS["api-integration"],
    signingSecret: process.env.ZOLT_INGEST_HMAC_SECRET,
    actorType: "API"
  };
}

export async function requireApiKey(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (isProduction() && process.env.ZOLT_ALLOW_INSECURE_AUTH === "true") {
    await reply.code(503).send({ code: "INSECURE_AUTH_FORBIDDEN_IN_PRODUCTION" });
    return;
  }

  const tenantHint = String(req.headers["x-zolt-tenant-id"] ?? "");
  const limit = Number(process.env.ZOLT_RATE_LIMIT_PER_MINUTE ?? 120);
  const tenantLimit = Number(process.env.ZOLT_TENANT_RATE_LIMIT_PER_MINUTE ?? 600);
  const allowedIp = await enforceRateLimit(req, reply, `ip:${clientIp(req)}`, limit);
  if (!allowedIp) {
    return;
  }
  if (tenantHint) {
    const allowedTenant = await enforceRateLimit(req, reply, `tenant:${tenantHint}`, tenantLimit);
    if (!allowedTenant) {
      return;
    }
  }

  const bearer = String(req.headers.authorization ?? "");
  if (bearer.startsWith("Bearer ") && sessionResolver) {
    const principal = await sessionResolver(bearer.slice(7));
    if (principal) {
      req.zoltAuth = principal;
      return;
    }
  }

  if (allowInsecureAuth() && !process.env.ZOLT_API_KEY && !credentialResolver) {
    req.zoltAuth = bootstrapPrincipal() ?? {
      tenantId: tenantHint || "anonymous",
      permissions: ROLE_PERMISSIONS["api-integration"],
      actorType: "API"
    };
    return;
  }

  const configured = process.env.ZOLT_API_KEY;
  if (!configured && !credentialResolver) {
    await reply.code(503).send({ code: "AUTH_NOT_CONFIGURED" });
    return;
  }

  const provided = String(req.headers["x-zolt-api-key"] ?? "");
  if (!provided) {
    await reply.code(401).send({ code: "UNAUTHORIZED" });
    return;
  }

  if (credentialResolver) {
    const principal = await credentialResolver(provided);
    if (principal) {
      req.zoltAuth = principal;
      return;
    }
  }

  if (configured && safeCompare(provided, configured)) {
    req.zoltAuth =
      bootstrapPrincipal() ?? {
        tenantId: tenantHint || "",
        permissions: ROLE_PERMISSIONS["api-integration"],
        signingSecret: process.env.ZOLT_INGEST_HMAC_SECRET,
        actorType: "API",
        unscoped: !isProduction()
      };
    return;
  }

  await reply.code(401).send({ code: "UNAUTHORIZED" });
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
  replayRedis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
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

export async function requireSignedIngest(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (isProduction() && process.env.ZOLT_ALLOW_INSECURE_AUTH === "true") {
    await reply.code(503).send({ code: "INSECURE_AUTH_FORBIDDEN_IN_PRODUCTION" });
    return;
  }

  const secret = req.zoltAuth?.signingSecret ?? process.env.ZOLT_INGEST_HMAC_SECRET;
  if (!secret && allowInsecureAuth()) {
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

  const body = JSON.stringify(req.body ?? {});
  const expected = createHmac("sha256", secret).update(`${timestampHeader}.${replayKey}.${body}`).digest("hex");
  if (!safeCompare(signatureHeader, expected)) {
    await reply.code(401).send({ code: "INVALID_INGEST_SIGNATURE" });
    return;
  }

  if (isProduction() && !process.env.REDIS_URL) {
    await reply.code(503).send({ code: "REPLAY_STORE_NOT_CONFIGURED" });
    return;
  }

  const claimed = await claimReplayKey(replayKey);
  if (!claimed) {
    await reply.code(409).send({ code: "REPLAY_DETECTED" });
    return;
  }
}

export function requirePermission(permission: PermissionKey) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const principal = req.zoltAuth;
    if (!principal) {
      await reply.code(401).send({ code: "UNAUTHORIZED" });
      return;
    }
    if (!principal.permissions.includes(permission) && !principal.permissions.includes("admin:manage")) {
      await reply.code(403).send({ code: "FORBIDDEN" });
      return;
    }
  };
}

export { verifySecret };
