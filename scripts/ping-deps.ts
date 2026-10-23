import "dotenv/config";
import { prisma } from "../packages/database/src/index.js";
import { pingQueue } from "../packages/queue/src/index.js";

process.stdout.write(`DB=${process.env.DATABASE_URL}\nREDIS=${process.env.REDIS_URL}\n`);
try {
  await prisma.$queryRaw`SELECT 1`;
  process.stdout.write("PRISMA_OK\n");
} catch (error) {
  process.stderr.write(`PRISMA_FAIL ${error instanceof Error ? error.message : String(error)}\n`);
}
try {
  await pingQueue();
  process.stdout.write("REDIS_PING_OK\n");
} catch (error) {
  process.stderr.write(`REDIS_FAIL ${error instanceof Error ? error.message : String(error)}\n`);
}
await prisma.$disconnect();
process.exit(0);
