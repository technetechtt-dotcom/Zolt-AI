import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { soakPassed } from "./lib/soak-policy.js";

const twentyFourHourReport = "docs/operations/soak-24h.json";
const multiDayReport = "docs/operations/soak-multiday.json";
const pollMs = Number(process.env.ZOLT_SOAK_SUPERVISOR_POLL_MS ?? 30_000);

interface SoakReport {
  inProgress?: boolean;
  soakMinutes?: number;
  durationMs?: number;
  failed?: number;
  successful?: number;
  messages?: number;
  aborted?: boolean;
  abortReason?: string;
}

function readCredentialEnv(): Record<string, string> {
  const path = process.env.ZOLT_LOAD_CREDENTIAL_FILE ?? "ops/load/credential.json";
  if (!existsSync(path)) return {};
  try {
    const cred = JSON.parse(readFileSync(path, "utf8")) as {
      apiKey?: string;
      hmacSecret?: string;
      tenantId?: string;
      productId?: string;
      installationId?: string;
    };
    return {
      ...(cred.apiKey ? { ZOLT_LOAD_API_KEY: cred.apiKey } : {}),
      ...(cred.hmacSecret ? { ZOLT_LOAD_HMAC_SECRET: cred.hmacSecret } : {}),
      ...(cred.tenantId ? { ZOLT_LOAD_TENANT_ID: cred.tenantId } : {}),
      ...(cred.productId ? { ZOLT_LOAD_PRODUCT_ID: cred.productId } : {}),
      ...(cred.installationId
        ? { ZOLT_LOAD_INSTALLATION_ID: cred.installationId }
        : {}),
    };
  } catch {
    return {};
  }
}

async function readReport(path: string): Promise<SoakReport | undefined> {
  try {
    return JSON.parse(await (await import("node:fs/promises")).readFile(path, "utf8")) as SoakReport;
  } catch {
    return undefined;
  }
}

function invalidEvidence(report: SoakReport | undefined): boolean {
  if (!report) return true;
  if (report.aborted) return true;
  if ((report.successful ?? 0) === 0 && (report.messages ?? 0) > 0) return true;
  return false;
}

function startSoak(minutes: number, report: string, traffic: string): void {
  const child = spawn(
    "corepack",
    [
      "pnpm",
      "exec",
      "tsx",
      "scripts/load-test.ts",
      "--tier",
      "10",
      "--soak-minutes",
      String(minutes),
      "--traffic",
      traffic,
      "--preflight",
      "20",
      "--report",
      report,
    ],
    {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        ...readCredentialEnv(),
        ZOLT_PERFORMANCE_TEST: "true",
        ZOLT_LOAD_API_KEY:
          process.env.ZOLT_LOAD_API_KEY ??
          readCredentialEnv().ZOLT_LOAD_API_KEY ??
          process.env.ZOLT_API_KEY ??
          "dev-api-key-change-me",
        ZOLT_LOAD_HMAC_SECRET:
          process.env.ZOLT_LOAD_HMAC_SECRET ??
          readCredentialEnv().ZOLT_LOAD_HMAC_SECRET ??
          process.env.ZOLT_INGEST_HMAC_SECRET ??
          "dev-hmac-secret-change-me",
        ZOLT_LOAD_DEVICES: process.env.ZOLT_SOAK_DEVICES ?? "10",
        ZOLT_LOAD_CONCURRENCY: process.env.ZOLT_LOAD_CONCURRENCY ?? "10",
        ZOLT_LOAD_MESSAGES_PER_DEVICE:
          process.env.ZOLT_SOAK_MESSAGES_PER_DEVICE ?? "5",
        ZOLT_LOAD_P95_BUDGET_MS: "10000",
        ZOLT_SOAK_FAILURE_THRESHOLD: process.env.ZOLT_SOAK_FAILURE_THRESHOLD ?? "0.001",
        ZOLT_LOAD_TRAFFIC: traffic,
      },
      shell: process.platform === "win32",
    },
  );
  child.unref();
}

process.stdout.write("soak-supervisor watching 24h then multi-day\n");
const currentAtBoot = await readReport(twentyFourHourReport);
if (
  !soakPassed({ ...currentAtBoot, targetMinutes: 1440 }) ||
  invalidEvidence(currentAtBoot)
) {
  await writeFile(
    twentyFourHourReport,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        inProgress: true,
        soakMinutes: 1440,
        startedAt: new Date().toISOString(),
        freshRun: true,
        priorInvalidEvidence: invalidEvidence(currentAtBoot),
      },
      null,
      2,
    )}\n`,
  );
  startSoak(1440, twentyFourHourReport, "steady");
  process.stdout.write("started fresh 24h soak after preflight-gated load harness\n");
}
for (;;) {
  const current = await readReport(twentyFourHourReport);
  if (soakPassed({ ...current, targetMinutes: 1440 })) {
    const queued = await readReport(multiDayReport);
    if (!soakPassed({ ...queued, targetMinutes: 4320 })) {
      if (!queued?.inProgress) {
        await writeFile(
          multiDayReport,
          `${JSON.stringify(
            {
              generatedAt: new Date().toISOString(),
              inProgress: true,
              soakMinutes: 4320,
              queuedAfter: "soak-24h-complete",
              startedAt: new Date().toISOString(),
              trafficProfile: "mix",
            },
            null,
            2,
          )}\n`,
        );
        startSoak(4320, multiDayReport, "mix");
        process.stdout.write("24h soak complete; started multi-day soak with mix traffic\n");
      }
    }
    if (soakPassed({ ...(await readReport(multiDayReport)), targetMinutes: 4320 })) {
      process.stdout.write("multi-day soak complete\n");
      break;
    }
  } else if (current?.aborted) {
    process.stderr.write(`24h soak aborted: ${current.abortReason ?? "unknown"}\n`);
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, pollMs));
}
