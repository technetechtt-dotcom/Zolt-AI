import { createHmac, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const api = process.env.ZOLT_API_BASE_URL ?? "http://localhost:4000";
const gateway = process.env.ZOLT_LOAD_URL ?? "http://localhost:4001/v1/ingest/gridflex";
const apiKey = process.env.ZOLT_API_KEY ?? "dev-api-key-change-me";
const hmac = process.env.ZOLT_INGEST_HMAC_SECRET ?? "dev-hmac-secret-change-me";

export interface Finding {
  id: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  title: string;
  result: "PASS" | "FAIL" | "SKIP";
  detail: string;
}

export function scoreFindings(findings: Finding[]): {
  failed: string[];
  skippedHighOrCritical: string[];
  result: "PASS" | "FAIL";
} {
  const failed = findings.filter((item) => item.result === "FAIL").map((item) => item.id);
  const skippedHighOrCritical = findings
    .filter(
      (item) =>
        item.result === "SKIP" &&
        (item.severity === "high" || item.severity === "critical"),
    )
    .map((item) => item.id);
  return {
    failed,
    skippedHighOrCritical,
    result: failed.length === 0 && skippedHighOrCritical.length === 0 ? "PASS" : "FAIL",
  };
}

async function probe(url: string, init?: RequestInit): Promise<{ status: number; body: string }> {
  try {
    const response = await fetch(url, { ...init, redirect: "manual" });
    return { status: response.status, body: await response.text() };
  } catch (error) {
    return { status: 0, body: error instanceof Error ? error.message : String(error) };
  }
}

function reachable(status: number): boolean {
  return status > 0;
}

export async function runSecurityAssessment(): Promise<Finding[]> {
  const findings: Finding[] = [];
  const live = await probe(`${api}/health/live`);
  findings.push({
    id: "PT-001",
    severity: "info",
    title: "API live endpoint reachable",
    result: live.status === 200 ? "PASS" : "FAIL",
    detail: `status=${live.status} body=${live.body.slice(0, 120)}`,
  });

  const noKey = await probe(`${api}/v1/telemetry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  findings.push({
    id: "PT-002",
    severity: "high",
    title: "Unauthenticated telemetry write is rejected",
    result: !reachable(noKey.status)
      ? "SKIP"
      : noKey.status === 401 || noKey.status === 503
        ? "PASS"
        : "FAIL",
    detail: `status=${noKey.status} body=${noKey.body.slice(0, 180)}`,
  });

  const tenantEscape = await probe(
    `${api}/v1/recommendations?tenantId=not-the-caller-tenant`,
    {
      headers: {
        "x-zolt-api-key": apiKey,
        "x-zolt-tenant-id": "not-the-caller-tenant",
      },
    },
  );
  findings.push({
    id: "PT-003",
    severity: "critical",
    title: "Cross-tenant recommendation read is rejected",
    result: !reachable(tenantEscape.status)
      ? "SKIP"
      : [401, 403, 400].includes(tenantEscape.status)
        ? "PASS"
        : "FAIL",
    detail: `status=${tenantEscape.status} body=${tenantEscape.body.slice(0, 180)}`,
  });

  const ssrf = await probe(`${api}/v1/webhooks`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zolt-api-key": apiKey,
      "x-zolt-tenant-id": "tenant-demo",
    },
    body: JSON.stringify({ url: "http://127.0.0.1:22/ssrf" }),
  });
  findings.push({
    id: "PT-004",
    severity: "critical",
    title: "Webhook SSRF to loopback is blocked",
    result: !reachable(ssrf.status) ? "SKIP" : ssrf.status >= 400 ? "PASS" : "FAIL",
    detail: `status=${ssrf.status} body=${ssrf.body.slice(0, 180)}`,
  });

  const replayKey = randomUUID();
  const timestamp = Date.now().toString();
  const body = JSON.stringify({
    messageId: `pentest-${replayKey}`,
    nodeId: "pentest-inverter",
    timestamp: new Date().toISOString(),
    readings: { powerKw: 1 },
  });
  const signature = createHmac("sha256", hmac)
    .update(`${timestamp}.${replayKey}.${body}`)
    .digest("hex");
  const ingestHeaders = {
    "content-type": "application/json",
    "x-zolt-api-key": apiKey,
    "x-zolt-tenant-id": "tenant-demo",
    "x-zolt-product-id": "product-demo",
    "x-zolt-installation-id": "installation-demo",
    "x-zolt-signature-ts": timestamp,
    "x-zolt-replay-key": replayKey,
    "x-zolt-signature": signature,
  };
  const first = await probe(gateway, { method: "POST", headers: ingestHeaders, body });
  const second = await probe(gateway, { method: "POST", headers: ingestHeaders, body });
  findings.push({
    id: "PT-005",
    severity: "high",
    title: "HMAC replay is rejected on second use",
    result: !reachable(first.status)
      ? "SKIP"
      : second.status === 409 || second.status === 401 || second.status === 400
        ? "PASS"
        : "FAIL",
    detail: `first=${first.status} second=${second.status}`,
  });

  const bogusSig = await probe(gateway, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zolt-api-key": apiKey,
      "x-zolt-signature-ts": timestamp,
      "x-zolt-replay-key": randomUUID(),
      "x-zolt-signature": "00",
    },
    body,
  });
  findings.push({
    id: "PT-006",
    severity: "high",
    title: "Invalid HMAC signature is rejected",
    result: !reachable(bogusSig.status)
      ? "SKIP"
      : bogusSig.status === 401 || bogusSig.status === 400
        ? "PASS"
        : "FAIL",
    detail: `status=${bogusSig.status}`,
  });

  return findings;
}

if (process.argv[1]?.endsWith("security-assessment.ts")) {
  const findings = await runSecurityAssessment();
  const scored = scoreFindings(findings);
  const report = {
    executedAt: new Date().toISOString(),
    kind: "automated-internal-preassessment",
    independentAssessor: false,
    apiBaseUrl: api,
    gatewayUrl: gateway,
    findings,
    ...scored,
  };
  await mkdir("docs/operations", { recursive: true });
  await writeFile(
    "docs/operations/security-assessment.json",
    `${JSON.stringify(report, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (scored.result !== "PASS") process.exitCode = 1;
}
