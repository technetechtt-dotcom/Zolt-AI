export interface SoakSample {
  ok: boolean;
  status: number;
}

export interface SoakPreflightResult {
  ok: boolean;
  attempted: number;
  succeeded: number;
  failed: number;
  statusCodes: Record<string, number>;
  reason?: string;
}

export const SOAK_PREFLIGHT_MIN = 10;
export const SOAK_PREFLIGHT_MAX = 100;
export const SOAK_FAILURE_THRESHOLD = 0.001;
export const SOAK_MAX_P95_MS = 1_000;
export const SOAK_MAX_P99_MS = 1_500;
export const SOAK_ABORT_P95_MS = 2_500;
export const SOAK_MAX_HEAP_GROWTH_MB = 64;
export const SOAK_MAX_RSS_MB = 512;
export const SOAK_MAX_QUEUE_AGE_MS = 30_000;
export const SOAK_MAX_DB_CONNECTIONS = 80;
export const SOAK_MAX_REDIS_MEMORY_MB = 512;
export const SOAK_MAX_DLQ = 0;
export const SOAK_MAX_WORKER_LAG = 1_000;

export function summarizeSamples(samples: SoakSample[]): {
  attempted: number;
  succeeded: number;
  failed: number;
  statusCodes: Record<string, number>;
} {
  const statusCodes: Record<string, number> = {};
  let succeeded = 0;
  for (const sample of samples) {
    const key = String(sample.status);
    statusCodes[key] = (statusCodes[key] ?? 0) + 1;
    if (sample.ok && sample.status === 202) succeeded += 1;
  }
  return {
    attempted: samples.length,
    succeeded,
    failed: samples.length - succeeded,
    statusCodes,
  };
}

export function evaluateSoakPreflight(
  samples: SoakSample[],
  options: { min?: number; max?: number } = {},
): SoakPreflightResult {
  const min = options.min ?? SOAK_PREFLIGHT_MIN;
  const max = options.max ?? SOAK_PREFLIGHT_MAX;
  const summary = summarizeSamples(samples);
  if (summary.attempted < min || summary.attempted > max) {
    return {
      ...summary,
      ok: false,
      reason: `PREFLIGHT_COUNT_OUT_OF_RANGE:${min}-${max}`,
    };
  }
  if (summary.succeeded !== summary.attempted) {
    return {
      ...summary,
      ok: false,
      reason: "PREFLIGHT_NOT_ALL_202",
    };
  }
  return { ...summary, ok: true };
}

export function soakShouldAbort(input: {
  messages: number;
  failed: number;
  threshold?: number;
  minimumMessages?: number;
  p95Ms?: number;
  abortP95Ms?: number;
}): boolean {
  const threshold = input.threshold ?? SOAK_FAILURE_THRESHOLD;
  const minimum = input.minimumMessages ?? 100;
  if (input.messages < minimum) return false;
  if (input.failed / input.messages > threshold) return true;
  if (
    typeof input.p95Ms === "number" &&
    input.p95Ms > (input.abortP95Ms ?? SOAK_ABORT_P95_MS)
  ) {
    return true;
  }
  return false;
}

export interface SoakCriteriaInput {
  inProgress?: boolean;
  soakMinutes?: number;
  durationMs?: number;
  messages?: number;
  successful?: number;
  failed?: number;
  aborted?: boolean;
  targetMinutes: number;
  failureThreshold?: number;
  p95Ms?: number;
  p99Ms?: number;
  maxP95Ms?: number;
  maxP99Ms?: number;
  heapGrowthMb?: number;
  growingHeap?: boolean;
  rssMb?: number;
  queueAgeMs?: number;
  dbConnections?: number;
  redisMemoryMb?: number;
  dlqCount?: number;
  duplicateRecommendations?: number;
  workerLag?: number;
}

export interface SoakCriteriaResult {
  ok: boolean;
  failures: string[];
}

export function evaluateSoakCriteria(
  input: SoakCriteriaInput,
): SoakCriteriaResult {
  const failures: string[] = [];
  if (input.aborted) failures.push("aborted");
  if (input.inProgress !== false) failures.push("still-in-progress");
  const elapsedMinutes = (input.durationMs ?? 0) / 60_000;
  if (elapsedMinutes + 0.5 < input.targetMinutes) {
    failures.push("duration-short");
  }
  const messages = input.messages ?? 0;
  const failed = input.failed ?? messages;
  const successful = input.successful ?? messages - failed;
  if (messages < 1) failures.push("no-messages");
  if (successful < 1) failures.push("zero-success");
  if (failed / Math.max(messages, 1) > (input.failureThreshold ?? SOAK_FAILURE_THRESHOLD)) {
    failures.push("failure-rate");
  }
  if ((input.p95Ms ?? 0) > (input.maxP95Ms ?? SOAK_MAX_P95_MS)) {
    failures.push("p95");
  }
  if ((input.p99Ms ?? 0) > (input.maxP99Ms ?? SOAK_MAX_P99_MS)) {
    failures.push("p99");
  }
  if (input.growingHeap || (input.heapGrowthMb ?? 0) > SOAK_MAX_HEAP_GROWTH_MB) {
    failures.push("heap-growth");
  }
  if ((input.rssMb ?? 0) > SOAK_MAX_RSS_MB) failures.push("rss");
  if ((input.queueAgeMs ?? 0) > SOAK_MAX_QUEUE_AGE_MS) failures.push("queue-age");
  if ((input.dbConnections ?? 0) > SOAK_MAX_DB_CONNECTIONS) {
    failures.push("db-connections");
  }
  if ((input.redisMemoryMb ?? 0) > SOAK_MAX_REDIS_MEMORY_MB) {
    failures.push("redis-memory");
  }
  if ((input.dlqCount ?? 0) > SOAK_MAX_DLQ) failures.push("dlq-growth");
  if ((input.duplicateRecommendations ?? 0) > 0) {
    failures.push("duplicate-recommendations");
  }
  if ((input.workerLag ?? 0) > SOAK_MAX_WORKER_LAG) failures.push("worker-lag");
  return { ok: failures.length === 0, failures };
}

export function soakPassed(input: SoakCriteriaInput): boolean {
  return evaluateSoakCriteria(input).ok;
}
