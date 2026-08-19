import { createHmac, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

const url =
  process.env.ZOLT_LOAD_URL ?? "http://localhost:4001/v1/ingest/gridflex";
const apiKey = process.env.ZOLT_LOAD_API_KEY ?? process.env.ZOLT_API_KEY;
const hmacSecret =
  process.env.ZOLT_LOAD_HMAC_SECRET ?? process.env.ZOLT_INGEST_HMAC_SECRET;
const tenantId = process.env.ZOLT_LOAD_TENANT_ID ?? "tenant-demo";
const productId = process.env.ZOLT_LOAD_PRODUCT_ID ?? "product-demo";
const installationId =
  process.env.ZOLT_LOAD_INSTALLATION_ID ?? "installation-demo";
const deviceCount = Number(process.env.ZOLT_LOAD_DEVICES ?? 10);
const messagesPerDevice = Number(
  process.env.ZOLT_LOAD_MESSAGES_PER_DEVICE ?? 10,
);
const concurrency = Number(process.env.ZOLT_LOAD_CONCURRENCY ?? 25);

if (!apiKey || !hmacSecret)
  throw new Error("ZOLT_LOAD_API_KEY and ZOLT_LOAD_HMAC_SECRET are required");
if (!Number.isInteger(deviceCount) || deviceCount < 1 || deviceCount > 100_000)
  throw new Error("ZOLT_LOAD_DEVICES_OUT_OF_RANGE");

interface Result {
  latencyMs: number;
  ok: boolean;
  status: number;
}
const tasks = Array.from(
  { length: deviceCount * messagesPerDevice },
  (_, index) => index,
);
const results: Result[] = [];
const started = performance.now();

async function send(index: number): Promise<void> {
  const device = index % deviceCount;
  const timestamp = Date.now().toString();
  const replayKey = randomUUID();
  const body = JSON.stringify({
    messageId: `load-${device}-${index}-${Date.now()}`,
    nodeId: `load-inverter-${device}`,
    timestamp: new Date().toISOString(),
    sequence: Math.floor(index / deviceCount),
    simulated: true,
    vendor: "Zolt load harness",
    model: "simulated",
    communicationHealth: "HEALTHY",
    readings: { powerKw: 100 + (device % 20), voltage: 400, frequencyHz: 50 },
  });
  const signature = createHmac("sha256", hmacSecret!)
    .update(`${timestamp}.${replayKey}.${body}`)
    .digest("hex");
  const before = performance.now();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zolt-api-key": apiKey!,
      "x-zolt-tenant-id": tenantId,
      "x-zolt-product-id": productId,
      "x-zolt-installation-id": installationId,
      "x-zolt-signature-ts": timestamp,
      "x-zolt-replay-key": replayKey,
      "x-zolt-signature": signature,
    },
    body,
  });
  results.push({
    latencyMs: performance.now() - before,
    ok: response.ok,
    status: response.status,
  });
}

async function worker(): Promise<void> {
  while (tasks.length) {
    const next = tasks.shift();
    if (next === undefined) return;
    try {
      await send(next);
    } catch {
      results.push({ latencyMs: 0, ok: false, status: 0 });
    }
  }
}

function percentile(values: number[], value: number): number {
  if (!values.length) return 0;
  return (
    values[Math.min(values.length - 1, Math.floor(values.length * value))] ?? 0
  );
}

await Promise.all(
  Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()),
);
const durationMs = performance.now() - started;
const latencies = results
  .filter((result) => result.latencyMs > 0)
  .map((result) => result.latencyMs)
  .sort((a, b) => a - b);
const report = {
  generatedAt: new Date().toISOString(),
  target: url,
  simulated: true,
  deviceCount,
  messages: results.length,
  successful: results.filter((result) => result.ok).length,
  failed: results.filter((result) => !result.ok).length,
  durationMs: Number(durationMs.toFixed(2)),
  messagesPerSecond: Number((results.length / (durationMs / 1000)).toFixed(2)),
  latencyMs: {
    p50: Number(percentile(latencies, 0.5).toFixed(2)),
    p95: Number(percentile(latencies, 0.95).toFixed(2)),
    p99: Number(percentile(latencies, 0.99).toFixed(2)),
  },
  statusCodes: Object.fromEntries(
    [...new Set(results.map((result) => result.status))].map((status) => [
      status,
      results.filter((result) => result.status === status).length,
    ]),
  ),
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (process.env.ZOLT_LOAD_REPORT)
  await writeFile(
    process.env.ZOLT_LOAD_REPORT,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
if (report.failed > 0) process.exitCode = 1;
