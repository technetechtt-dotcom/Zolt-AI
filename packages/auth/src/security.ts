import type { FastifyInstance } from "fastify";
import { isProduction } from "./crypto.js";

export function applySecurityHeaders(app: FastifyInstance): void {
  app.addHook("onRequest", async (req, reply) => {
    const allowed = corsOrigin();
    const requestOrigin = String(req.headers.origin ?? "");
    if (Array.isArray(allowed) && allowed.includes(requestOrigin)) {
      reply.header("access-control-allow-origin", requestOrigin);
      reply.header("vary", "origin");
    } else if (typeof allowed === "string" && allowed && allowed === requestOrigin) {
      reply.header("access-control-allow-origin", requestOrigin);
    }
    reply.header("access-control-allow-headers", "content-type, x-zolt-api-key, x-zolt-tenant-id, x-zolt-product-id, x-zolt-installation-id, x-zolt-signature, x-zolt-signature-ts, x-zolt-replay-key, x-correlation-id, authorization");
    reply.header("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
    if (req.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });
  app.addHook("onSend", async (_req, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-xss-protection", "0");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
    reply.header("content-security-policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'");
    if (isProduction()) {
      reply.header("strict-transport-security", "max-age=63072000; includeSubDomains; preload");
    }
  });
}

export function corsOrigin(): string | string[] {
  const configured = process.env.ZOLT_CORS_ORIGINS;
  if (configured) {
    return configured.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return isProduction() ? [] : ["http://localhost:4002", "http://localhost:5173"];
}

export function bodyLimitBytes(): number {
  return Number(process.env.ZOLT_BODY_LIMIT_BYTES ?? 256 * 1024);
}

export function assertTlsIfProduction(): void {
  if (isProduction() && process.env.ZOLT_REQUIRE_TLS !== "false") {
    if (process.env.ZOLT_TLS_TERMINATED !== "true") {
      throw new Error("TLS_REQUIRED: set ZOLT_TLS_TERMINATED=true behind a TLS proxy or disable with ZOLT_REQUIRE_TLS=false");
    }
  }
}
