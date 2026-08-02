import type { FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";

export function correlationIdFromRequest(req: FastifyRequest): string {
  const existing = req.headers["x-correlation-id"];
  if (typeof existing === "string" && existing.length > 0) {
    return existing;
  }
  return randomUUID();
}

export function logError(scope: string, error: unknown): void {
  const normalized = error instanceof Error ? error.message : String(error);
  // Simple baseline observability until tracing backend is wired.
  console.error(`[${scope}] ${normalized}`);
}
