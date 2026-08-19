import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __zoltPrisma: PrismaClient | undefined;
}

const queryEvents = process.env.ZOLT_SLOW_QUERY_MS !== undefined;

export const prisma =
  globalThis.__zoltPrisma ??
  new PrismaClient({
    log: queryEvents
      ? [
          { emit: "event", level: "query" },
          { emit: "stdout", level: "error" },
        ]
      : process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["error"],
  });

if (queryEvents) {
  (prisma as any).$on(
    "query",
    (event: { duration: number; query: string; target: string }) => {
      const threshold = Number(process.env.ZOLT_SLOW_QUERY_MS ?? 1000);
      if (event.duration >= threshold) {
        console.warn(
          JSON.stringify({
            level: "warn",
            scope: "database.slow_query",
            durationMs: event.duration,
            operation: event.query.trim().split(/\s+/)[0],
            target: event.target,
            ts: new Date().toISOString(),
          }),
        );
      }
    },
  );
}

if (process.env.NODE_ENV !== "production") {
  globalThis.__zoltPrisma = prisma;
}
