import { execSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import {
  evaluateSoakCriteria,
  evaluateSoakPreflight,
  soakShouldAbort,
} from "./lib/soak-policy.js";

function gitSha(): string | undefined {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

const commitSha = gitSha();

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

function loadSoakCredential(): {
  apiKey?: string;
  hmacSecret?: string;
  tenantId?: string;
  productId?: string;
  installationId?: string;
} {
  const path = process.env.ZOLT_LOAD_CREDENTIAL_FILE ?? "ops/load/credential.json";
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as {
      apiKey?: string;
      hmacSecret?: string;
      tenantId?: string;
      productId?: string;
      installationId?: string;
    };
  } catch {
    return {};
  }
}

const soakCredential = loadSoakCredential();
const url = process.env.ZOLT_LOAD_URL ?? "http://localhost:4001/v1/ingest/gridflex";
const apiKey =
  process.env.ZOLT_LOAD_API_KEY ?? soakCredential.apiKey ?? process.env.ZOLT_API_KEY;
const hmacSecret =
  process.env.ZOLT_LOAD_HMAC_SECRET ??
  soakCredential.hmacSecret ??
  process.env.ZOLT_INGEST_HMAC_SECRET;
const tenantId =
  process.env.ZOLT_LOAD_TENANT_ID ?? soakCredential.tenantId ?? "tenant-demo";
const productId =
  process.env.ZOLT_LOAD_PRODUCT_ID ?? soakCredential.productId ?? "product-demo";
const installationId =
  process.env.ZOLT_LOAD_INSTALLATION_ID ??
  soakCredential.installationId ??
  "installation-demo";
const trafficProfile = String(
  argValue("--traffic") ?? process.env.ZOLT_LOAD_TRAFFIC ?? "steady",
);
const failureThreshold = Number(
  process.env.ZOLT_SOAK_FAILURE_THRESHOLD ?? "0.001",
);
const preflightCount = Number(
  argValue("--preflight") ?? process.env.ZOLT_SOAK_PREFLIGHT ?? "20",
);
const tier = String(argValue("--tier") ?? process.env.ZOLT_LOAD_TIER ?? "10");
const soakMinutes = Number(argValue("--soak-minutes") ?? process.env.ZOLT_SOAK_MINUTES ?? "0");
const reconnectEvery = Number(argValue("--reconnect-every") ?? process.env.ZOLT_RECONNECT_BURST_EVERY ?? "0");
const reconnectPauseMs = Number(argValue("--reconnect-pause-ms") ?? process.env.ZOLT_RECONNECT_BURST_PAUSE_MS ?? "500");
const reportPath = argValue("--report") ?? process.env.ZOLT_LOAD_REPORT ?? "docs/operations/load-result.json";

const defaultsByTier: Record<string, { devices: number; messagesPerDevice: number; concurrency: number }> = {
  "10": { devices: 10, messagesPerDevice: 100, concurrency: 20 },
  "100": { devices: 100, messagesPerDevice: 100, concurrency: 40 },
  "1000": { devices: 1000, messagesPerDevice: 50, concurrency: 32 },
  "10000": { devices: 10000, messagesPerDevice: 10, concurrency: 32 }
};
const defaults = defaultsByTier[tier] ?? defaultsByTier["10"];
if (!defaults) {
  throw new Error(`Unsupported load tier: ${tier}`);
}

const deviceCount = Number(process.env.ZOLT_LOAD_DEVICES ?? defaults.devices);
const messagesPerDevice = Number(process.env.ZOLT_LOAD_MESSAGES_PER_DEVICE ?? defaults.messagesPerDevice);
const concurrency = Number(process.env.ZOLT_LOAD_CONCURRENCY ?? defaults.concurrency);
const p95BudgetMs = Number(process.env.ZOLT_LOAD_P95_BUDGET_MS ?? "500");

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
      signal: AbortSignal.timeout(15_000),
      headers: {
        "content-type": "application/json",
        "x-zolt-api-key": apiKey,
        "x-zolt-tenant-id": tenantId,
        "x-zolt-product-id": productId,
        "x-zolt-installation-id": installationId,
        "x-zolt-signature-ts": timestamp,
        "x-zolt-replay-key": replayKey,
        "x-zolt-signature": signature,
        "x-zolt-load-harness": "true"
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
  const results: Result[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const next = cursor;
      cursor += 1;
      if (next >= taskCount) return;
      results.push(await send(next));
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, taskCount) }, () => worker()),
  );
  return results;
}

const started = performance.now();
const startedAt = Date.now();
let reconnectBursts = 0;
let messages = 0;
let successful = 0;
let failed = 0;
const latencies: number[] = [];
const statusCodes = new Map<number, number>();

function ingest(results: Result[]): void {
  for (const result of results) {
    messages += 1;
    if (messages % 5_000 === 0) {
      process.stderr.write(`load-progress messages=${messages} failed=${failed}\n`);
    }
    if (result.ok) successful += 1;
    else failed += 1;
    if (result.latencyMs > 0) {
      latencies.push(result.latencyMs);
      if (latencies.length > 50_000) latencies.splice(0, latencies.length - 20_000);
    }
    statusCodes.set(result.status, (statusCodes.get(result.status) ?? 0) + 1);
  }
}

const resourceSamples: Array<Record<string, unknown>> = [];

async function sampleResources(): Promise<Record<string, unknown>> {
  const mem = process.memoryUsage();
  const sample: Record<string, unknown> = {
    at: new Date().toISOString(),
    rssMb: Number((mem.rss / 1024 / 1024).toFixed(1)),
    heapUsedMb: Number((mem.heapUsed / 1024 / 1024).toFixed(1)),
  };
  try {
    const health = await fetch("http://localhost:4000/v1/queues/health", {
      headers: {
        "x-zolt-api-key": apiKey ?? "",
        "x-zolt-tenant-id": tenantId,
        "x-zolt-load-harness": "true",
      },
      signal: AbortSignal.timeout(3000),
    });
    if (health.ok) {
      const queues = (await health.json()) as Record<string, unknown>;
      sample.queues = queues;
      sample.queueAgeMs = Number(queues.oldestAgeMs ?? queues.oldestWaitingMs ?? 0);
      sample.dlqCount = Number(queues.failed ?? queues.dlq ?? 0);
      sample.workerLag = Number(queues.delayed ?? queues.lag ?? 0);
    }
  } catch {
    /* ignore */
  }
  try {
    const ready = await fetch("http://localhost:4000/health/ready", {
      signal: AbortSignal.timeout(2000),
    });
    sample.apiReady = ready.ok;
  } catch {
    sample.apiReady = false;
  }
  try {
    const worker = await fetch("http://localhost:4003/health/ready", {
      signal: AbortSignal.timeout(2000),
    });
    sample.workerReady = worker.ok;
    if (worker.ok) {
      const body = (await worker.json()) as Record<string, unknown>;
      sample.workerRssMb = body.rssMb;
      sample.redisMemoryMb = body.redisMemoryMb;
      sample.dbConnections = body.dbConnections;
    }
  } catch {
    sample.workerReady = false;
  }
  resourceSamples.push(sample);
  if (resourceSamples.length > 96) resourceSamples.splice(0, resourceSamples.length - 48);
  return sample;
}

function leakSignals(): Record<string, unknown> {
  if (resourceSamples.length < 4) return { inconclusive: true };
  const first = resourceSamples[0] as { heapUsedMb?: number };
  const last = resourceSamples.at(-1) as { heapUsedMb?: number };
  const heapGrowthMb = Number((((last?.heapUsedMb ?? 0) - (first?.heapUsedMb ?? 0)).toFixed(1)));
  return {
    heapGrowthMb,
    sampleCount: resourceSamples.length,
    growingHeap: heapGrowthMb > 64,
  };
}

function latencySnapshot(): { p50: number; p95: number; p99: number } {
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    p50: Number(percentile(sorted, 0.5).toFixed(2)),
    p95: Number(percentile(sorted, 0.95).toFixed(2)),
    p99: Number(percentile(sorted, 0.99).toFixed(2)),
  };
}

function soakReportFields(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const durationMs = performance.now() - started;
  const latencyMs = latencySnapshot();
  const resources = leakSignals();
  const latest = resourceSamples.at(-1) as Record<string, unknown> | undefined;
  const passCriteria = evaluateSoakCriteria({
    inProgress: extra.inProgress as boolean | undefined,
    soakMinutes,
    durationMs,
    messages,
    successful,
    failed,
    aborted: Boolean(aborted),
    targetMinutes: soakMinutes,
    failureThreshold,
    p95Ms: latencyMs.p95,
    p99Ms: latencyMs.p99,
    heapGrowthMb: Number((resources as { heapGrowthMb?: number }).heapGrowthMb ?? 0),
    growingHeap: Boolean((resources as { growingHeap?: boolean }).growingHeap),
    rssMb: Number(latest?.rssMb ?? 0),
    queueAgeMs: Number(latest?.queueAgeMs ?? 0),
    dbConnections: Number(latest?.dbConnections ?? 0),
    redisMemoryMb: Number(latest?.redisMemoryMb ?? 0),
    dlqCount: Number(latest?.dlqCount ?? 0),
    duplicateRecommendations: 0,
    workerLag: Number(latest?.workerLag ?? 0),
  });
  return {
    evidenceVersion: 1,
    generatedAt: new Date().toISOString(),
    commitSha,
    environment: process.env.ZOLT_ENVIRONMENT ?? "local",
    operator: process.env.ZOLT_EVIDENCE_OPERATOR ?? "soak-harness",
    target: url,
    simulated: true,
    tier,
    deviceCount,
    messagesPerDevice,
    soakMinutes,
    trafficProfile,
    reconnectEvery,
    reconnectPauseMs,
    reconnectBursts,
    aborted: Boolean(aborted),
    abortReason: aborted,
    preflight,
    failureThreshold,
    messages,
    successful,
    failed,
    durationMs: Number(durationMs.toFixed(2)),
    messagesPerSecond: Number((messages / Math.max(durationMs / 1000, 0.001)).toFixed(2)),
    latencyMs,
    p95BudgetMs,
    statusCodes: Object.fromEntries(statusCodes),
    resources,
    latestSample: latest,
    passCriteria,
    ...extra,
  };
}

async function checkpoint(cycle: number): Promise<void> {
  await sampleResources();
  const report = soakReportFields({
    cycle,
    inProgress: soakMinutes > 0 && !aborted,
  });
  await mkdir("docs/operations", { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

const reconnectCycles = Number(argValue("--cycles") ?? process.env.ZOLT_LOAD_CYCLES ?? "0");
let aborted: string | undefined;
let preflight:
  | ReturnType<typeof evaluateSoakPreflight>
  | undefined;

if (soakMinutes > 0) {
  const preflightSamples = await runBurst(
    Math.min(100, Math.max(10, preflightCount)),
  );
  preflight = evaluateSoakPreflight(preflightSamples);
  if (!preflight.ok) {
    aborted = preflight.reason ?? "PREFLIGHT_FAILED";
    await mkdir("docs/operations", { recursive: true });
    await writeFile(
      reportPath,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          target: url,
          soakMinutes,
          inProgress: false,
          aborted: true,
          abortReason: aborted,
          preflight,
          messages: 0,
          successful: 0,
          failed: 0,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    process.stderr.write(`soak refused: ${aborted}\n`);
    process.exit(2);
  }
  const endAt = startedAt + soakMinutes * 60_000;
  const cycleBudgetMs = Number(process.env.ZOLT_SOAK_CYCLE_MS ?? "2500");
  let cycle = 0;
  while (Date.now() < endAt) {
    cycle += 1;
    const cycleStarted = Date.now();
    const mixSlow = trafficProfile === "mix" && cycle % 17 === 0;
    const mixBurst = trafficProfile === "mix" && cycle % 11 === 0;
    const reconnectNow =
      (reconnectEvery > 0 && cycle % reconnectEvery === 0) ||
      (trafficProfile === "mix" && cycle % 23 === 0);
    ingest(
      await runBurst(
        deviceCount * messagesPerDevice * (mixBurst ? 3 : 1),
      ),
    );
    if (mixSlow) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    if (reconnectNow) {
      reconnectBursts += 1;
      await new Promise((resolve) =>
        setTimeout(resolve, mixBurst ? reconnectPauseMs || 800 : reconnectPauseMs),
      );
    }
    if (
      soakShouldAbort({
        messages,
        failed,
        threshold: failureThreshold,
        p95Ms: latencySnapshot().p95,
      })
    ) {
      aborted = "FAILURE_THRESHOLD_EXCEEDED";
      await checkpoint(cycle);
      break;
    }
    await checkpoint(cycle);
    const remain = cycleBudgetMs - (Date.now() - cycleStarted);
    if (remain > 0) {
      await new Promise((resolve) => setTimeout(resolve, remain));
    }
  }
} else if (reconnectEvery > 0 || reconnectCycles > 0) {
  const cycles = Math.max(reconnectCycles, reconnectEvery > 0 ? 6 : 1);
  for (let cycle = 1; cycle <= cycles; cycle += 1) {
    ingest(await runBurst(deviceCount * messagesPerDevice));
    if (reconnectEvery > 0 && cycle % reconnectEvery === 0 && cycle < cycles) {
      reconnectBursts += 1;
      await new Promise((resolve) => setTimeout(resolve, reconnectPauseMs));
    }
    await checkpoint(cycle);
  }
} else {
  ingest(await runBurst(deviceCount * messagesPerDevice));
}

await sampleResources();
const report = soakReportFields({ inProgress: false });

await mkdir("docs/operations", { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
const latency = report.latencyMs as { p95: number };
if (
  aborted ||
  (soakMinutes === 0 && (Number(report.failed) > 0 || latency.p95 > p95BudgetMs)) ||
  (soakMinutes > 0 &&
    Number(report.failed) / Math.max(Number(report.messages), 1) > failureThreshold)
) {
  process.exitCode = 1;
}
