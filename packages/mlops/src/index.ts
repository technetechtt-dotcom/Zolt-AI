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
  safetyThresholds?: {
    maximumDrift?: number;
    maximumError?: number;
    disablementThreshold?: number;
  };
  datasetVersion?: string;
  features?: string[];
  trainingDates?: { startedAt?: string; completedAt?: string };
  deploymentStatus?: "not-deployed" | "shadow" | "canary" | "production";
  rollbackPoint?: string;
  disablementThreshold?: number;
  modelCard?: string;
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

export function evaluateChallenger(input: {
  name: string;
  championVersion: string;
  challengerVersion: string;
  tenantId?: string;
  metric?: string;
}): {
  promote: boolean;
  metric: string;
  champion: number;
  challenger: number;
  reason: string;
} {
  const champion = getModel(input.name, input.championVersion, input.tenantId);
  const challenger = getModel(
    input.name,
    input.challengerVersion,
    input.tenantId,
  );
  if (!champion || champion.status !== "champion") {
    throw new Error("CHAMPION_NOT_FOUND");
  }
  if (!challenger || challenger.status !== "challenger") {
    throw new Error("CHALLENGER_NOT_FOUND");
  }
  const metric = input.metric ?? "mae";
  const championValue = Number(champion.evaluation?.[metric] ?? Number.POSITIVE_INFINITY);
  const challengerValue = Number(
    challenger.evaluation?.[metric] ?? Number.POSITIVE_INFINITY,
  );
  const promote = challengerValue < championValue;
  return {
    promote,
    metric,
    champion: championValue,
    challenger: challengerValue,
    reason: promote
      ? "challenger improves the champion metric"
      : "challenger does not beat the champion",
  };
}

export function detectAutomatedDrift(input: {
  name: string;
  version: string;
  tenantId?: string;
  featureDrift?: Record<string, number>;
  predictionDrift?: number;
  residualMean?: number;
  residualStd?: number;
  forecastBias?: number;
  anomalyRate?: number;
  baselineAnomalyRate?: number;
}): ModelCard {
  const maxFeature = Math.max(
    0,
    ...Object.values(input.featureDrift ?? { _: 0 }),
  );
  const anomalyShift = Math.abs(
    (input.anomalyRate ?? 0) - (input.baselineAnomalyRate ?? 0),
  );
  return updateModelDrift({
    name: input.name,
    version: input.version,
    tenantId: input.tenantId,
    dataDrift: Math.max(maxFeature, Math.abs(input.forecastBias ?? 0)),
    predictionDrift: Math.max(
      input.predictionDrift ?? 0,
      Math.abs(input.residualMean ?? 0) + (input.residualStd ?? 0) / 10,
    ),
    performanceError: anomalyShift,
  });
}
