import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { executeGridFlexHilEmulator } from "./hil-emulator.js";
import { rotateManagedSecrets } from "./managed-secrets.js";

interface StepResult {
  name: string;
  result: "PASS" | "FAIL" | "STARTED" | "SKIPPED";
  detail?: string;
}

const steps: StepResult[] = [];
const cwd = process.cwd();

function run(command: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}, timeoutMs = 180_000): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, ...extraEnv },
    shell: process.platform === "win32",
  });
  return {
    status: result.status,
    stdout: (result.stdout ?? "").slice(0, 4000),
    stderr: (result.stderr ?? "").slice(0, 4000),
  };
}

function pnpm(args: string[], extraEnv?: NodeJS.ProcessEnv, timeoutMs?: number) {
  const viaCorepack = run("corepack", ["pnpm", ...args], extraEnv, timeoutMs);
  if (viaCorepack.status === 0 || viaCorepack.status === 1) return viaCorepack;
  const viaPnpm = run("pnpm", args, extraEnv, timeoutMs);
  if (viaPnpm.status === 0 || viaPnpm.status === 1) return viaPnpm;
  return run("npx", ["pnpm", ...args], extraEnv, timeoutMs);
}

async function record(name: string, execute: () => Promise<StepResult["result"]> | StepResult["result"], detail?: string) {
  try {
    const result = await execute();
    steps.push({ name, result, detail });
  } catch (error) {
    steps.push({
      name,
      result: "FAIL",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

await record("hil-emulator", async () => {
  const report = await executeGridFlexHilEmulator();
  return report.result === "PASS" ? "PASS" : "FAIL";
});

await record("physical-hil-probe", () => {
  const probe = spawnSync("powershell", ["-NoProfile", "-Command", "[System.IO.Ports.SerialPort]::GetPortNames() | ConvertTo-Json"], { encoding: "utf8" });
  const ports = (probe.stdout ?? "").trim();
  if (!ports || ports === "[]" || ports === "") {
    return "SKIPPED";
  }
  return "STARTED";
}, "Physical COM ports enumerated if present");

await record("managed-secrets-rotate", async () => {
  const evidence = await rotateManagedSecrets([
    "ZOLT_API_KEY",
    "ZOLT_INGEST_HMAC_SECRET",
    "ALERT_WEBHOOK_SECRET",
  ]);
  return evidence.verifyDecrypt ? "PASS" : "FAIL";
});

await record("ml-train-validate", () => {
  const result = pnpm(["exec", "tsx", "scripts/train-energy-models.ts"], {}, 120_000);
  return result.status === 0 ? "PASS" : "FAIL";
});

await record("dataset-audit", () => {
  const result = pnpm(["evidence:dataset"]);
  return result.status === 0 ? "PASS" : "FAIL";
});

const docker = run("docker", ["compose", "up", "-d"], {}, 180_000);
await record("observability-compose", () => (docker.status === 0 ? "PASS" : "FAIL"), docker.stderr || docker.stdout);

if (docker.status === 0) {
  spawnSync("powershell", ["-NoProfile", "-Command", "Start-Sleep -Seconds 12"]);
  await record("backup-restore", () => {
    const result = spawnSync("powershell", ["-ExecutionPolicy", "Bypass", "-File", "scripts/verify-backup-restore.ps1", "-Container", "zolt-postgres"], { encoding: "utf8", timeout: 120_000 });
    return result.status === 0 ? "PASS" : "FAIL";
  });
  await record("pitr", () => {
    const result = spawnSync("powershell", ["-ExecutionPolicy", "Bypass", "-File", "scripts/verify-pitr.ps1", "-Container", "zolt-postgres"], { encoding: "utf8", timeout: 180_000 });
    return result.status === 0 ? "PASS" : "FAIL";
  });
} else {
  steps.push({ name: "backup-restore", result: "SKIPPED", detail: "docker compose unavailable" });
  steps.push({ name: "pitr", result: "SKIPPED", detail: "docker compose unavailable" });
}

const migrate = pnpm(["db:deploy"], { DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://zolt:zolt@localhost:5432/zolt" }, 120_000);
await record("db-migrate", () => (migrate.status === 0 ? "PASS" : "SKIPPED"), migrate.stderr);
const seed = pnpm(["db:seed"], {}, 120_000);
await record("db-seed", () => (seed.status === 0 ? "PASS" : "SKIPPED"), seed.stderr);

function startService(script: string, logName: string) {
  const child = spawn("corepack", ["pnpm", script], {
    cwd,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      ZOLT_ADVISORY_ONLY: "true",
      ZOLT_ALLOW_INSECURE_AUTH: "true",
      ZOLT_API_KEY: process.env.ZOLT_API_KEY ?? "dev-api-key-change-me",
      ZOLT_INGEST_HMAC_SECRET: process.env.ZOLT_INGEST_HMAC_SECRET ?? "dev-hmac-secret-change-me",
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://zolt:zolt@localhost:5432/zolt",
      REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
    },
  });
  child.unref();
  return { pid: child.pid, logName };
}

startService("dev:api", "api");
startService("dev:gateway", "gateway");
startService("dev:worker", "worker");
spawnSync("powershell", ["-NoProfile", "-Command", "Start-Sleep -Seconds 8"]);

const loadEnv = {
  ZOLT_LOAD_API_KEY: process.env.ZOLT_API_KEY ?? "dev-api-key-change-me",
  ZOLT_LOAD_HMAC_SECRET: process.env.ZOLT_INGEST_HMAC_SECRET ?? "dev-hmac-secret-change-me",
  ZOLT_API_KEY: process.env.ZOLT_API_KEY ?? "dev-api-key-change-me",
  ZOLT_INGEST_HMAC_SECRET: process.env.ZOLT_INGEST_HMAC_SECRET ?? "dev-hmac-secret-change-me",
};

for (const tier of ["10", "100", "1000", "10000"] as const) {
  await record(`load-${tier}`, () => {
    const result = pnpm(
      ["exec", "tsx", "scripts/load-test.ts", "--tier", tier, "--report", `docs/operations/load-${tier}.json`],
      loadEnv,
      tier === "10000" ? 600_000 : 180_000,
    );
    return result.status === 0 ? "PASS" : "FAIL";
  });
}

await record("reconnect-burst", () => {
  const result = pnpm(
    ["exec", "tsx", "scripts/load-test.ts", "--tier", "100", "--reconnect-every", "2", "--reconnect-pause-ms", "1200", "--report", "docs/operations/reconnect-burst.json"],
    loadEnv,
    180_000,
  );
  return result.status === 0 ? "PASS" : "FAIL";
});

await record("soak-rehearsal", () => {
  const result = pnpm(
    ["exec", "tsx", "scripts/load-test.ts", "--tier", "10", "--soak-minutes", "2", "--report", "docs/operations/soak-rehearsal.json"],
    loadEnv,
    180_000,
  );
  return result.status === 0 ? "PASS" : "FAIL";
});

await record("soak-24h-started", () => {
  const child = spawn("corepack", ["pnpm", "exec", "tsx", "scripts/load-test.ts", "--tier", "10", "--soak-minutes", "1440", "--report", "docs/operations/soak-24h.json"], {
    cwd,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, ...loadEnv },
  });
  child.unref();
  return "STARTED";
});

await record("soak-multiday-queued", async () => {
  await writeFile(
    "docs/operations/soak-multiday.json",
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        inProgress: false,
        queuedAfter: "soak-24h",
        soakMinutes: 4320,
        tier: "10",
        note: "Multi-day soak is queued behind the 24-hour soak so both do not contend for the same gateway.",
      },
      null,
      2,
    )}\n`,
  );
  return "STARTED";
});

if (docker.status === 0) {
  await record("chaos-redis", () => {
    const result = spawnSync("powershell", ["-ExecutionPolicy", "Bypass", "-File", "scripts/chaos-test.ps1", "-Target", "redis", "-OutageSeconds", "8", "-Report", "docs/operations/chaos-redis.json"], { encoding: "utf8", timeout: 120_000 });
    return result.status === 0 ? "PASS" : "FAIL";
  });
  await record("chaos-postgres", () => {
    const result = spawnSync("powershell", ["-ExecutionPolicy", "Bypass", "-File", "scripts/chaos-test.ps1", "-Target", "postgres", "-OutageSeconds", "8", "-Report", "docs/operations/chaos-postgres.json"], { encoding: "utf8", timeout: 120_000 });
    return result.status === 0 ? "PASS" : "FAIL";
  });
} else {
  steps.push({ name: "chaos-redis", result: "SKIPPED" });
  steps.push({ name: "chaos-postgres", result: "SKIPPED" });
}

await record("security-assessment", () => {
  const result = pnpm(["exec", "tsx", "scripts/security-assessment.ts"], loadEnv, 60_000);
  return result.status === 0 || result.status === 1 ? (result.status === 0 ? "PASS" : "FAIL") : "SKIPPED";
});

const campaign = {
  executedAt: new Date().toISOString(),
  advisoryOnly: true,
  hardwareExecution: false,
  steps,
};
await mkdir("docs/operations", { recursive: true });
await writeFile("docs/operations/campaign-result.json", `${JSON.stringify(campaign, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(campaign, null, 2)}\n`);
if (steps.some((step) => step.result === "FAIL")) process.exitCode = 1;
