export interface EvidenceEnvelope {
  evidenceVersion?: number;
  generatedAt?: string;
  executedAt?: string;
  result?: string;
  status?: string;
  gate?: string;
  commitSha?: string;
  environment?: string;
  operator?: string;
  reviewer?: string;
  witness?: string;
  inProgress?: boolean;
  aborted?: boolean;
  recovered?: boolean;
  queuedTelemetrySurvived?: boolean | null;
  messages?: number;
  successful?: number;
  failed?: number;
  blockedReason?: string;
  reason?: string;
  note?: string;
  steps?: Array<{ name?: string; result?: string }>;
  managedSecrets?: boolean;
  namedSite?: string | null;
  namedPlant?: string | null;
  realNamedPlant?: boolean;
  realNamedPlantConnected?: boolean;
  independentAssessor?: boolean;
  queuedAfter?: string;
  soakMinutes?: number;
  durationMs?: number;
  [key: string]: unknown;
}

export function decodeEvidenceBuffer(buffer: Buffer): string {
  let text: string;
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    text = buffer.toString("utf16le");
  } else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.alloc(buffer.length - 2);
    for (let i = 2; i + 1 < buffer.length; i += 2) {
      swapped[i - 2] = buffer[i + 1] ?? 0;
      swapped[i - 1] = buffer[i] ?? 0;
    }
    text = swapped.toString("utf16le");
  } else {
    text = buffer.toString("utf8");
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.trim();
}

export function parseEvidenceJson(buffer: Buffer): EvidenceEnvelope {
  return JSON.parse(decodeEvidenceBuffer(buffer)) as EvidenceEnvelope;
}

function worstStepResult(steps: Array<{ result?: string }>): string | undefined {
  const rank = ["FAIL", "BLOCKED", "ABORTED", "NOT_COMMISSIONED", "SKIPPED", "STARTED", "QUEUED", "PASS"];
  let worst: string | undefined;
  let worstRank = Number.POSITIVE_INFINITY;
  for (const step of steps) {
    const value = String(step.result ?? "").toUpperCase();
    if (!value) continue;
    const index = rank.indexOf(value);
    const score = index === -1 ? 50 : index;
    if (score < worstRank) {
      worst = value;
      worstRank = score;
    }
  }
  return worst;
}

export function interpretEvidence(
  file: string,
  parsed: EvidenceEnvelope,
): { status: string; notes: string } {
  if (file === "evidence-summary.json") {
    return { status: "META", notes: "aggregator output" };
  }
  if (file.endsWith(".template.json")) {
    return { status: "TEMPLATE", notes: parsed.note ? String(parsed.note) : "" };
  }
  if (String(parsed.result ?? "").toUpperCase() === "INTERRUPTED") {
    return {
      status: "INTERRUPTED",
      notes: String(parsed.abortReason ?? parsed.note ?? ""),
    };
  }
  if (parsed.aborted) return { status: "ABORTED", notes: String(parsed.reason ?? "") };
  if (parsed.inProgress) return { status: "IN_PROGRESS", notes: durationNote(parsed) };
  if (parsed.blockedReason) {
    return { status: "BLOCKED", notes: String(parsed.blockedReason) };
  }
  if (typeof parsed.result === "string" && parsed.result.trim()) {
    return {
      status: String(parsed.result).toUpperCase(),
      notes: String(parsed.reason ?? parsed.note ?? parsed.blockedReason ?? ""),
    };
  }
  if (typeof parsed.status === "string" && parsed.status.trim()) {
    return {
      status: String(parsed.status).toUpperCase(),
      notes: String(parsed.reason ?? parsed.note ?? ""),
    };
  }
  if (typeof parsed.gate === "string" && parsed.gate.trim()) {
    return { status: String(parsed.gate).toUpperCase(), notes: String(parsed.reason ?? "") };
  }
  if (typeof parsed.outcome === "string" && parsed.outcome.trim()) {
    return {
      status: String(parsed.outcome).toUpperCase(),
      notes: String(parsed.reason ?? parsed.note ?? ""),
    };
  }
  if (parsed.recovered === false) return { status: "FAIL", notes: "not recovered" };
  if (parsed.queuedTelemetrySurvived === false) {
    return { status: "FAIL", notes: "queue loss" };
  }
  if (Array.isArray(parsed.steps) && parsed.steps.length > 0) {
    return {
      status: worstStepResult(parsed.steps) ?? "UNKNOWN",
      notes: parsed.steps
        .map((step) => `${step.name ?? "step"}:${step.result ?? "?"}`)
        .join("; "),
    };
  }
  if (file === "credential-rotation.json") {
    if (parsed.managedSecrets === false) {
      return {
        status: "BLOCKED",
        notes: "managed secrets backend not configured",
      };
    }
    return { status: "PASS", notes: "credentials rotated" };
  }
  if (file === "dataset-manifest.json" || file.startsWith("dataset-manifest")) {
    if (parsed.realNamedPlant === false) {
      return {
        status: "ENGINEERING",
        notes: "emulator/synthetic dataset; not a named plant",
      };
    }
    return { status: "PASS", notes: String(parsed.datasetId ?? "") };
  }
  if (file === "gridflex-pilot.json") {
    if (parsed.realNamedPlantConnected === false) {
      return {
        status: "ENGINEERING",
        notes: "controlled emulator pilot; no named plant",
      };
    }
    return { status: "PASS", notes: String(parsed.pilotId ?? "") };
  }
  if (file === "soak-multiday.json") {
    if (parsed.queuedAfter && !parsed.durationMs) {
      return { status: "QUEUED", notes: String(parsed.queuedAfter) };
    }
  }
  if (typeof parsed.messages === "number") {
    if (parsed.successful === 0 && parsed.messages > 0) {
      return { status: "FAIL", notes: `0/${parsed.messages} ok` };
    }
    if (typeof parsed.successful === "number" && (parsed.failed ?? 0) === 0) {
      return { status: "PASS", notes: `${parsed.successful}/${parsed.messages} ok` };
    }
  }
  if (parsed.independentAssessor === false) {
    return { status: "NOT_COMMISSIONED", notes: String(parsed.note ?? "") };
  }
  if (parsed.namedSite === null || parsed.namedPlant === null) {
    return { status: "BLOCKED", notes: String(parsed.reason ?? "no named site") };
  }
  return { status: "UNKNOWN", notes: String(parsed.note ?? parsed.reason ?? "") };
}

function durationNote(parsed: EvidenceEnvelope): string {
  if (typeof parsed.messages === "number") {
    return `${parsed.successful ?? 0}/${parsed.messages} ok`;
  }
  if (typeof parsed.soakMinutes === "number") {
    return `${parsed.soakMinutes} min target`;
  }
  return "";
}

export function requiredEvidenceFields(parsed: EvidenceEnvelope): string[] {
  const missing: string[] = [];
  if (!parsed.evidenceVersion) missing.push("evidenceVersion");
  if (!parsed.generatedAt && !parsed.executedAt) missing.push("generatedAt");
  if (!parsed.commitSha) missing.push("commitSha");
  if (!parsed.environment) missing.push("environment");
  if (!parsed.operator) missing.push("operator");
  return missing;
}
