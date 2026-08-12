import type { FastifyReply, FastifyRequest } from "fastify";
import { Redis } from "ioredis";

let limiterRedis: Redis | null | undefined;

function client(): Redis | null {
  if (limiterRedis !== undefined) {
    return limiterRedis;
  }
  if (!process.env.REDIS_URL) {
    limiterRedis = null;
    return limiterRedis;
  }
  limiterRedis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  return limiterRedis;
}

const memory = new Map<string, { count: number; resetAt: number }>();

export async function enforceRateLimit(
  req: FastifyRequest,
  reply: FastifyReply,
  key: string,
  limit: number,
  windowMs = 60_000
): Promise<boolean> {
  const redis = client();
  if (redis) {
    const redisKey = `zolt:rl:${key}`;
    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.pexpire(redisKey, windowMs);
    }
    if (count > limit) {
      await reply.code(429).send({ code: "RATE_LIMITED" });
      return false;
    }
    return true;
  }

  const now = Date.now();
  const current = memory.get(key);
  if (!current || current.resetAt < now) {
    memory.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  current.count += 1;
  if (current.count > limit) {
    await reply.code(429).send({ code: "RATE_LIMITED" });
    return false;
  }
  return true;
}

export function clientIp(req: FastifyRequest): string {
  return String(req.headers["x-forwarded-for"] ?? req.ip ?? "unknown").split(",")[0]?.trim() ?? "unknown";
}
