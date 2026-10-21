import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const twentyFourHourReport = "docs/operations/soak-24h.json";
const multiDayReport = "docs/operations/soak-multiday.json";
const pollMs = Number(process.env.ZOLT_SOAK_SUPERVISOR_POLL_MS ?? 30_000);

interface SoakReport {
  inProgress?: boolean;
  soakMinutes?: number;
  durationMs?: number;
  failed?: number;
  successful?: number;
}

async function readReport(path: string): Promise<SoakReport | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as SoakReport;
  } catch {
    return undefined;
  }
}

function complete(report: SoakReport | undefined, minutes: number): boolean {
  if (!report) return false;
  const elapsedMinutes = (report.durationMs ?? 0) / 60_000;
  return report.inProgress === false && elapsedMinutes + 0.5 >= minutes;
}

function startSoak(minutes: number, report: string): void {
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
      "--report",
      report,
    ],
    {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        ZOLT_LOAD_API_KEY: process.env.ZOLT_LOAD_API_KEY ?? process.env.ZOLT_API_KEY ?? "dev-api-key-change-me",
        ZOLT_LOAD_HMAC_SECRET:
          process.env.ZOLT_LOAD_HMAC_SECRET ??
          process.env.ZOLT_INGEST_HMAC_SECRET ??
          "dev-hmac-secret-change-me",
        ZOLT_LOAD_CONCURRENCY: process.env.ZOLT_LOAD_CONCURRENCY ?? "10",
        ZOLT_LOAD_MESSAGES_PER_DEVICE: process.env.ZOLT_LOAD_MESSAGES_PER_DEVICE ?? "5",
        ZOLT_LOAD_P95_BUDGET_MS: "10000",
      },
      shell: process.platform === "win32",
    },
  );
  child.unref();
}

process.stdout.write("soak-supervisor watching 24h then multi-day\n");
for (;;) {
  const current = await readReport(twentyFourHourReport);
  if (complete(current, 1440)) {
    const queued = await readReport(multiDayReport);
    if (!queued?.inProgress && (queued?.durationMs ?? 0) < 4320 * 60_000) {
      await writeFile(
        multiDayReport,
        `${JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            inProgress: true,
            soakMinutes: 4320,
            queuedAfter: "soak-24h-complete",
            startedAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
      );
      startSoak(4320, multiDayReport);
      process.stdout.write("24h soak complete; started multi-day soak\n");
    }
    if (complete(await readReport(multiDayReport), 4320)) {
      process.stdout.write("multi-day soak complete\n");
      break;
    }
  }
  await new Promise((resolve) => setTimeout(resolve, pollMs));
}
