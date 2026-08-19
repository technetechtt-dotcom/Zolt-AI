import { readFile } from "node:fs/promises";

interface Requirement {
  key: string;
  path: string;
  validator: (content: string) => boolean;
  message: string;
}

const requirements: Requirement[] = [
  {
    key: "hil",
    path: "docs/HIL_TEST_REPORT.md",
    validator: (content) => content.includes("Status: **EXECUTED ON PHYSICAL HARDWARE**"),
    message: "Physical GridFlex HIL evidence must be marked executed."
  },
  {
    key: "load",
    path: "docs/LOAD_TEST_REPORT.md",
    validator: (content) => ["10 devices", "100 devices", "1,000 devices", "10,000 devices"].every((needle) => content.includes(needle)),
    message: "Load report must contain 10/100/1,000/10,000 tiers."
  },
  {
    key: "backup-restore",
    path: "docs/BACKUP_RESTORE_PROOF.md",
    validator: (content) => content.includes("RPO") && content.includes("RTO") && content.includes("PITR"),
    message: "Backup restore proof must include measured RPO/RTO and PITR."
  },
  {
    key: "pentest",
    path: "docs/PENETRATION_TEST_REPORT.md",
    validator: (content) =>
      content.includes("Independent penetration test") &&
      content.includes("Remediation") &&
      content.includes("Retest"),
    message: "Pen-test report must include independent test, remediation, and retest."
  },
  {
    key: "operations",
    path: "docs/OPERATIONS_EVIDENCE.md",
    validator: (content) => content.includes("managed secrets") && content.includes("alert routing"),
    message: "Operations evidence must include managed secrets and alert routing."
  }
];

async function run(): Promise<void> {
  const failures: string[] = [];
  for (const item of requirements) {
    try {
      const content = await readFile(item.path, "utf8");
      if (!item.validator(content)) {
        failures.push(`[${item.key}] ${item.message}`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push(`[${item.key}] Missing or unreadable file ${item.path}: ${reason}`);
    }
  }

  if (failures.length > 0) {
    process.stderr.write(`Readiness evidence checks failed:\n- ${failures.join("\n- ")}\n`);
    process.exit(1);
  }

  process.stdout.write("Readiness evidence checks passed.\n");
}

void run();
