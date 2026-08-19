export interface ModelCard {
  tenantId?: string;
  name: string;
  version: string;
  status: "candidate" | "champion" | "challenger" | "disabled" | "retired";
  artifactUri?: string;
  trainingDatasetVersion?: string;
  featureSetVersion?: string;
  trainingParameters?: Record<string, unknown>;
  trainedAt?: string;
  owner?: string;
  approvalOwner?: string;
  approvedAt?: string;
  environment?: "development" | "staging" | "production";
  rollbackVersion?: string;
  evaluation?: Record<string, number>;
  driftStatus?: "unknown" | "healthy" | "warning" | "critical";
  explainability?: Record<string, unknown>;
  intendedUse?: string;
  limitations?: string[];
  safetyThresholds?: { maximumDrift?: number; maximumError?: number };
  metadata: Record<string, unknown>;
}

export interface PredictionAudit {
  tenantId: string;
  modelName: string;
  modelVersion: string;
  predictionId: string;
  createdAt: string;
  inputsHash: string;
  output: Record<string, unknown>;
}

const registry = new Map<string, ModelCard>();
const predictionAudit: PredictionAudit[] = [];

function key(name: string, version: string, tenantId?: string): string {
  return `${tenantId ?? "global"}:${name}:${version}`;
}

export function registerModel(card: ModelCard): void {
  if (card.status === "champion" && (!card.evaluation || !card.approvalOwner)) {
    throw new Error("MODEL_APPROVAL_METADATA_REQUIRED");
  }
  registry.set(key(card.name, card.version, card.tenantId), {
    driftStatus: "unknown",
    ...card,
  });
}

export function getModel(
  name: string,
  version: string,
  tenantId?: string,
): ModelCard | undefined {
  return (
    registry.get(key(name, version, tenantId)) ??
    registry.get(key(name, version))
  );
}

export function listModels(name?: string, tenantId?: string): ModelCard[] {
  return [...registry.values()].filter(
    (card) =>
      (!name || card.name === name) &&
      (!card.tenantId || !tenantId || card.tenantId === tenantId),
  );
}

export function promoteChampion(
  name: string,
  version: string,
  input: { tenantId?: string; approvalOwner: string; approvedAt?: string },
): void {
  const target = getModel(name, version, input.tenantId);
  if (!target) throw new Error("MODEL_NOT_FOUND");
  if (!target.evaluation) throw new Error("MODEL_EVALUATION_REQUIRED");
  for (const card of registry.values()) {
    if (
      card.name === name &&
      card.tenantId === input.tenantId &&
      card.status === "champion"
    )
      card.status = "retired";
  }
  target.status = "champion";
  target.approvalOwner = input.approvalOwner;
  target.approvedAt = input.approvedAt ?? new Date().toISOString();
}

export function updateModelDrift(input: {
  name: string;
  version: string;
  tenantId?: string;
  dataDrift: number;
  predictionDrift: number;
  performanceError?: number;
}): ModelCard {
  const card = getModel(input.name, input.version, input.tenantId);
  if (!card) throw new Error("MODEL_NOT_FOUND");
  const maximumDrift = card.safetyThresholds?.maximumDrift ?? 0.25;
  const maximumError =
    card.safetyThresholds?.maximumError ?? Number.POSITIVE_INFINITY;
  const critical =
    input.dataDrift > maximumDrift ||
    input.predictionDrift > maximumDrift ||
    (input.performanceError ?? 0) > maximumError;
  const warning =
    input.dataDrift > maximumDrift * 0.7 ||
    input.predictionDrift > maximumDrift * 0.7;
  card.driftStatus = critical ? "critical" : warning ? "warning" : "healthy";
  card.metadata = {
    ...card.metadata,
    dataDrift: input.dataDrift,
    predictionDrift: input.predictionDrift,
    performanceError: input.performanceError,
    driftCheckedAt: new Date().toISOString(),
  };
  if (critical) card.status = "disabled";
  return card;
}

export function recordPrediction(audit: PredictionAudit): void {
  predictionAudit.push(audit);
  if (predictionAudit.length > 10_000)
    predictionAudit.splice(0, predictionAudit.length - 10_000);
}

export function listPredictionAudit(
  tenantId: string,
  limit = 100,
): PredictionAudit[] {
  return predictionAudit
    .filter((row) => row.tenantId === tenantId)
    .slice(-limit)
    .reverse();
}
