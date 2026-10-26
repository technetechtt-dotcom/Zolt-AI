import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface EvidenceRow {
  file: string;
  result?: string;
  inProgress?: boolean;
  aborted?: boolean;
  recovered?: boolean;
  queuedTelemetrySurvived?: boolean | null;
  messages?: number;
  successful?: number;
  failed?: number;
  status?: string;
  blockedReason?: string;
}

function statusOf(row: EvidenceRow): string {
  if (row.aborted) return "ABORTED";
  if (row.inProgress) return "IN_PROGRESS";
  if (row.blockedReason) return "BLOCKED";
  if (row.result) return String(row.result).toUpperCase();
  if (row.status) return String(row.status).toUpperCase();
  if (row.recovered === false) return "FAIL";
  if (row.queuedTelemetrySurvived === false) return "FAIL";
  if (typeof row.messages === "number" && row.successful === 0 && row.messages > 0) {
    return "FAIL";
  }
  if (typeof row.successful === "number" && row.failed === 0) return "PASS";
  return "UNKNOWN";
}

async function main(): Promise<void> {
  const dir = "docs/operations";
  const files = (await readdir(dir)).filter((name) => name.endsWith(".json"));
  const rows: EvidenceRow[] = [];
  for (const file of files) {
    try {
      const parsed = JSON.parse(await readFile(join(dir, file), "utf8")) as Record<
        string,
        unknown
      >;
      const run = Array.isArray(parsed.runs)
        ? (parsed.runs as Array<Record<string, unknown>>).find(
            (item) => item.target === "redis",
          ) ?? parsed
        : parsed;
      rows.push({
        file,
        result: parsed.result as string | undefined,
        inProgress: parsed.inProgress as boolean | undefined,
        aborted: parsed.aborted as boolean | undefined,
        recovered: run.recovered as boolean | undefined,
        queuedTelemetrySurvived: run.queuedTelemetrySurvived as boolean | null,
        messages: parsed.messages as number | undefined,
        successful: parsed.successful as number | undefined,
        failed: parsed.failed as number | undefined,
        status: (parsed.status as string | undefined) ?? (parsed.gate as string | undefined),
        blockedReason:
          (parsed.blockedReason as string | undefined) ??
          (parsed.reason as string | undefined),
      });
    } catch {
      rows.push({ file, result: "UNREADABLE" });
    }
  }

  const lines = [
    "# Implementation status (generated)",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "This file is generated from `docs/operations/*.json` by `pnpm evidence:aggregate`. Do not edit by hand.",
    "",
    "| Artifact | Status | Notes |",
    "| --- | --- | --- |",
  ];
  for (const row of rows.sort((a, b) => a.file.localeCompare(b.file))) {
    const notes = [
      row.messages !== undefined ? `${row.successful ?? 0}/${row.messages} ok` : "",
      row.queuedTelemetrySurvived === false ? "queue loss" : "",
      row.blockedReason ?? "",
    ]
      .filter(Boolean)
      .join("; ");
    lines.push(`| \`${row.file}\` | ${statusOf(row)} | ${notes} |`);
  }

  const blockers = rows.filter((row) =>
    ["FAIL", "BLOCKED", "ABORTED", "UNREADABLE"].includes(statusOf(row)),
  );
  lines.push(
    "",
    "## Release readiness",
    "",
    blockers.length
      ? `Not ready: ${blockers.length} failing or blocked artifacts.`
      : "No failing JSON artifacts were found. External blockers (physical HIL, independent pen test, named plant) still require non-local evidence.",
    "",
    "Mandatory external items still tracked: managed secrets, alert routing, independent penetration test, physical HIL, named field pilot.",
    "",
  );

  const ledger = [
    "# Production-readiness evidence ledger",
    "",
    `Updated: ${new Date().toISOString().slice(0, 10)}`,
    "",
    "Generated from `docs/operations/*.json`. Treat JSON artifacts as source of truth.",
    "",
    ...lines.slice(6),
  ];

  await mkdir("docs", { recursive: true });
  await writeFile("docs/IMPLEMENTATION_STATUS.md", `${lines.join("\n")}\n`, "utf8");
  await writeFile("docs/OPERATIONS_EVIDENCE.md", `${ledger.join("\n")}\n`, "utf8");
  await writeFile(
    "docs/operations/evidence-summary.json",
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        artifacts: rows.map((row) => ({ file: row.file, status: statusOf(row) })),
        failing: blockers.map((row) => row.file),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  process.stdout.write(`aggregated ${rows.length} evidence files\n`);
}

void main();
