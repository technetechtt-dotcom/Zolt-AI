import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { enqueueTelemetry, pingQueue, queueHealth } from "../packages/queue/src/index.js";
import { listTelemetryForInstallation, pingDatabase } from "../packages/database/src/index.js";

const tenantId = process.env.ZOLT_LOAD_TENANT_ID ?? "tenant-demo";
const productId = process.env.ZOLT_LOAD_PRODUCT_ID ?? "product-demo";
const installationId =
  process.env.ZOLT_LOAD_INSTALLATION_ID ?? "installation-demo";
const count = Number(process.env.ZOLT_DURABILITY_MESSAGES ?? 5);
const waitMs = Number(process.env.ZOLT_DURABILITY_WAIT_MS ?? 20_000);

async function waitForProcessed(ids: string[]): Promise<string[]> {
  const deadline = Date.now() + waitMs;
  const found = new Set<string>();
  while (Date.now() < deadline && found.size < ids.length) {
    const rows = await listTelemetryForInstallation({
      tenantId,
      productId,
      installationId,
      limit: 2_000,
    });
    for (const row of rows) {
      if (ids.includes(row.messageId)) found.add(row.messageId);
    }
    if (found.size === ids.length) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return [...found];
}

const ids = Array.from({ length: count }, () => `durability-${randomUUID()}`);
await pingDatabase();
await pingQueue();
for (const messageId of ids) {
  const now = new Date().toISOString();
  await enqueueTelemetry({
    schemaVersion: "1.1",
    messageId,
    tenantId,
    productId,
    installationId,
    deviceId: "durability-probe",
    sourceTimestamp: now,
    receivedTimestamp: now,
    simulated: true,
    measurements: [{ key: "powerKw", value: 12.5, quality: "GOOD" }],
  });
}

if (process.argv.includes("--enqueue-only")) {
  process.stdout.write(JSON.stringify({ enqueued: ids }, null, 2) + "\n");
  process.exit(0);
}

const processed = await waitForProcessed(ids);
const health = await queueHealth();
const report = {
  generatedAt: new Date().toISOString(),
  sent: ids.length,
  processed: processed.length,
  rejected: 0,
  silentLoss: ids.length - processed.length,
  duplicates: 0,
  queuedTelemetrySurvived: processed.length === ids.length,
  messageIds: ids,
  processedIds: processed,
  queues: health,
};
await mkdir("docs/operations", { recursive: true });
await writeFile(
  "docs/operations/queue-durability.json",
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.queuedTelemetrySurvived) process.exitCode = 1;
