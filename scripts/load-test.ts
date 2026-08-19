import { createHmac, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

function argValue(name: string): string | undefined {
  const pair = process.argv.find((item) => item.startsWith(`${name}=`));
  if (pair) {
    return pair.slice(name.length + 1);
  }
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  return undefined;
}

const url = process.env.ZOLT_LOAD_URL ?? "http://localhost:4001/v1/ingest/gridflex";
const apiKey = process.env.ZOLT_LOAD_API_KEY ?? process.env.ZOLT_API_KEY;
const hmacSecret = process.env.ZOLT_LOAD_HMAC_SECRET ?? process.env.ZOLT_INGEST_HMAC_SECRET;
const tenantId = process.env.ZOLT_LOAD_TENANT_ID ?? "tenant-demo";
const productId = process.env.ZOLT_LOAD_PRODUCT_ID ?? "product-demo";
const installationId = process.env.ZOLT_LOAD_INSTALLATION_ID ?? "installation-demo";
const tier = String(argValue("--tier") ?? process.env.ZOLT_LOAD_TIER ?? "10");
const soakMinutes = Number(argValue("--soak-minutes") ?? process.env.ZOLT_SOAK_MINUTES ?? "0");
const reconnectEvery = Number(argValue("--reconnect-every") ?? process.env.ZOLT_RECONNECT_BURST_EVERY ?? "0");
const reconnectPauseMs = Number(argValue("--reconnect-pause-ms") ?? process.env.ZOLT_RECONNECT_BURST_PAUSE_MS ?? "500");
const reportPath = argValue("--report") ?? process.env.ZOLT_LOAD_REPORT ?? "docs/operations/load-result.json";

const defaultsByTier: Record<string, { devices: number; messagesPerDevice: number; concurrency: number }> = {
  "10": { devices: 10, messagesPerDevice: 100, concurrency: 20 },
  "100": { devices: 100, messagesPerDevice: 100, concurrency: 60 },
  "1000": { devices: 1000, messagesPerDevice: 50, concurrency: 150 },
  "10000": { devices: 10000, messagesPerDevice: 10, concurrency: 300 }
};
const defaults = defaultsByTier[tier] ?? defaultsByTier["10"];
if (!defaults) {
  throw new Error(`Unsupported load tier: ${tier}`);
}

const deviceCount = Number(process.env.ZOLT_LOAD_DEVICES ?? defaults.devices);
const messagesPerDevice = Number(process.env.ZOLT_LOAD_MESSAGES_PER_DEVICE ?? defaults.messagesPerDevice);
const concurrency = Number(process.env.ZOLT_LOAD_CONCURRENCY ?? defaults.concurrency);

if (!apiKey || !hmacSecret) {
  throw new Error("ZOLT_LOAD_API_KEY and ZOLT_LOAD_HMAC_SECRET are required");
}
if (!Number.isInteger(deviceCount) || deviceCount < 1 || deviceCount > 200_000) {
  throw new Error("ZOLT_LOAD_DEVICES_OUT_OF_RANGE");
}

interface Result {
  latencyMs: number;
  ok: boolean;
  status: number;
}

async function send(index: number): Promise<Result> {
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
    readings: { powerKw: 100 + (device % 20), voltage: 400, frequencyHz: 50 }
  });
  const signature = createHmac("sha256", hmacSecret).update(`${timestamp}.${replayKey}.${body}`).digest("hex");
  const before = performance.now();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-zolt-api-key": apiKey,
        "x-zolt-tenant-id": tenantId,
        "x-zolt-product-id": productId,
        "x-zolt-installation-id": installationId,
        "x-zolt-signature-ts": timestamp,
        "x-zolt-replay-key": replayKey,
        "x-zolt-signature": signature
      },
      body
    });
    return { latencyMs: performance.now() - before, ok: response.ok, status: response.status };
  } catch {
    return { latencyMs: 0, ok: false, status: 0 };
  }
}

function percentile(values: number[], value: number): number {
  if (!values.length) return 0;
  return values[Math.min(values.length - 1, Math.floor(values.length * value))] ?? 0;
}

async function runBurst(taskCount: number): Promise<Result[]> {
  const tasks = Array.from({ length: taskCount }, (_, index) => index);
  const results: Result[] = [];
  async function worker(): Promise<void> {
    while (tasks.length) {
      const next = tasks.shift();
      if (next === undefined) return;
      results.push(await send(next));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
  return results;
}

const started = performance.now();
const startedAt = Date.now();
const allResults: Result[] = [];
let reconnectBursts = 0;

if (soakMinutes > 0) {
  const endAt = startedAt + soakMinutes * 60_000;
  let cycle = 0;
  while (Date.now() < endAt) {
    cycle += 1;
    allResults.push(...(await runBurst(deviceCount * messagesPerDevice)));
    if (reconnectEvery > 0 && cycle % reconnectEvery === 0) {
      reconnectBursts += 1;
      await new Promise((resolve) => setTimeout(resolve, reconnectPauseMs));
    }
  }
} else {
  allResults.push(...(await runBurst(deviceCount * messagesPerDevice)));
}

const durationMs = performance.now() - started;
const latencies = allResults
  .filter((result) => result.latencyMs > 0)
  .map((result) => result.latencyMs)
  .sort((a, b) => a - b);
const report = {
  generatedAt: new Date().toISOString(),
  target: url,
  simulated: true,
  tier,
  deviceCount,
  messagesPerDevice,
  soakMinutes,
  reconnectEvery,
  reconnectPauseMs,
  reconnectBursts,
  messages: allResults.length,
  successful: allResults.filter((result) => result.ok).length,
  failed: allResults.filter((result) => !result.ok).length,
  durationMs: Number(durationMs.toFixed(2)),
  messagesPerSecond: Number((allResults.length / (durationMs / 1000)).toFixed(2)),
  latencyMs: {
    p50: Number(percentile(latencies, 0.5).toFixed(2)),
    p95: Number(percentile(latencies, 0.95).toFixed(2)),
    p99: Number(percentile(latencies, 0.99).toFixed(2))
  },
  statusCodes: Object.fromEntries(
    [...new Set(allResults.map((result) => result.status))].map((status) => [
      status,
      allResults.filter((result) => result.status === status).length
    ])
  )
};

await mkdir("docs/operations", { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.failed > 0) {
  process.exitCode = 1;
}
