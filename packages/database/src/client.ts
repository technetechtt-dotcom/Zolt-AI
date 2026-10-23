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

export async function pingDatabase(timeoutMs = 1_500): Promise<void> {
  const run = async (): Promise<void> => {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("DATABASE_PING_TIMEOUT")), timeoutMs);
      }),
    ]);
  };
  try {
    await run();
    return;
  } catch {
    try {
      await prisma.$disconnect();
    } catch {
      /* ignore */
    }
    await prisma.$connect();
    await run();
  }
}
