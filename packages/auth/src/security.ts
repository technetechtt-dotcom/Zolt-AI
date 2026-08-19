import type { FastifyInstance } from "fastify";
import { isProduction } from "./crypto.js";

export function applySecurityHeaders(app: FastifyInstance): void {
  app.addHook("onRequest", async (req, reply) => {
    const allowed = corsOrigin();
    const requestOrigin = String(req.headers.origin ?? "");
    if (Array.isArray(allowed) && allowed.includes(requestOrigin)) {
      reply.header("access-control-allow-origin", requestOrigin);
      reply.header("vary", "origin");
    } else if (
      typeof allowed === "string" &&
      allowed &&
      allowed === requestOrigin
    ) {
      reply.header("access-control-allow-origin", requestOrigin);
    }
    reply.header(
      "access-control-allow-headers",
      "content-type, x-zolt-api-key, x-zolt-tenant-id, x-zolt-product-id, x-zolt-installation-id, x-zolt-signature, x-zolt-signature-ts, x-zolt-replay-key, x-correlation-id, authorization",
    );
    reply.header(
      "access-control-allow-methods",
      "GET,POST,PATCH,DELETE,OPTIONS",
    );
    if (req.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });
  app.addHook("onSend", async (_req, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-xss-protection", "0");
    reply.header(
      "permissions-policy",
      "camera=(), microphone=(), geolocation=()",
    );
    reply.header(
      "content-security-policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'",
    );
    if (isProduction()) {
      reply.header(
        "strict-transport-security",
        "max-age=63072000; includeSubDomains; preload",
      );
    }
  });
}

export function corsOrigin(): string | string[] {
  const configured = process.env.ZOLT_CORS_ORIGINS;
  if (configured) {
    return configured
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return isProduction()
    ? []
    : ["http://localhost:4002", "http://localhost:5173"];
}

export function bodyLimitBytes(): number {
  return Number(process.env.ZOLT_BODY_LIMIT_BYTES ?? 256 * 1024);
}

export function assertTlsIfProduction(): void {
  if (isProduction() && process.env.ZOLT_REQUIRE_TLS !== "false") {
    if (process.env.ZOLT_TLS_TERMINATED !== "true") {
      throw new Error(
        "TLS_REQUIRED: set ZOLT_TLS_TERMINATED=true behind a TLS proxy or disable with ZOLT_REQUIRE_TLS=false",
      );
    }
  }
}

export function assertProductionConfiguration(
  service: "api" | "gateway" | "worker" | "console",
): void {
  if (!isProduction()) return;
  const errors: string[] = [];
  if (process.env.ZOLT_ALLOW_INSECURE_AUTH === "true")
    errors.push("ZOLT_ALLOW_INSECURE_AUTH must be unset");
  if (process.env.ZOLT_ALLOW_ENV_BOOTSTRAP === "true")
    errors.push("ZOLT_ALLOW_ENV_BOOTSTRAP is forbidden");
  if (process.env.ZOLT_API_KEY)
    errors.push("ZOLT_API_KEY is forbidden; use database-backed credentials");
  if (process.env.ZOLT_ADVISORY_ONLY !== "true")
    errors.push("ZOLT_ADVISORY_ONLY must be true");
  if (
    !process.env.ZOLT_SECRETS_PROVIDER ||
    process.env.ZOLT_SECRETS_PROVIDER === "env"
  )
    errors.push("a managed ZOLT_SECRETS_PROVIDER is required");
  if (service !== "console") {
    if (!process.env.ZOLT_MASTER_KEY || process.env.ZOLT_MASTER_KEY.length < 32)
      errors.push("ZOLT_MASTER_KEY must contain at least 32 characters");
    if (!process.env.DATABASE_URL) errors.push("DATABASE_URL is required");
    if (!process.env.REDIS_URL) errors.push("REDIS_URL is required");
  }
  if (service === "api" || service === "gateway" || service === "console") {
    try {
      assertTlsIfProduction();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (errors.length)
    throw new Error(`PRODUCTION_CONFIGURATION_INVALID:${errors.join(";")}`);
}
