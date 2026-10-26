import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { interpretEvidence, parseEvidenceJson } from "./lib/evidence.js";

interface EvidenceRow {
  file: string;
  status: string;
  notes: string;
}

async function main(): Promise<void> {
  const dir = "docs/operations";
  const files = (await readdir(dir)).filter((name) => name.endsWith(".json"));
  const rows: EvidenceRow[] = [];
  for (const file of files) {
    try {
      const parsed = parseEvidenceJson(await readFile(join(dir, file)));
      const interpreted = interpretEvidence(file, parsed);
      rows.push({ file, status: interpreted.status, notes: interpreted.notes });
    } catch (error) {
      rows.push({
        file,
        status: "UNREADABLE",
        notes: error instanceof Error ? error.message : "parse failed",
      });
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
    lines.push(
      `| \`${row.file}\` | ${row.status} | ${row.notes.replaceAll("|", "/")} |`,
    );
  }

  const blockers = rows.filter((row) =>
    [
      "FAIL",
      "BLOCKED",
      "ABORTED",
      "UNREADABLE",
      "NOT_COMMISSIONED",
      "NO-GO",
    ].includes(row.status),
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
        evidenceVersion: 1,
        generatedAt: new Date().toISOString(),
        result: "META",
        artifacts: rows.map((row) => ({
          file: row.file,
          status: row.status,
          notes: row.notes,
        })),
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
