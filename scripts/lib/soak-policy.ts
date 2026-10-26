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
}): boolean {
  const threshold = input.threshold ?? SOAK_FAILURE_THRESHOLD;
  const minimum = input.minimumMessages ?? 100;
  if (input.messages < minimum) return false;
  return input.failed / input.messages > threshold;
}

export function soakPassed(input: {
  inProgress?: boolean;
  soakMinutes?: number;
  durationMs?: number;
  messages?: number;
  failed?: number;
  aborted?: boolean;
  targetMinutes: number;
  failureThreshold?: number;
}): boolean {
  if (input.aborted) return false;
  if (input.inProgress !== false) return false;
  const elapsedMinutes = (input.durationMs ?? 0) / 60_000;
  if (elapsedMinutes + 0.5 < input.targetMinutes) return false;
  const messages = input.messages ?? 0;
  if (messages < 1) return false;
  const failed = input.failed ?? messages;
  return failed / messages <= (input.failureThreshold ?? SOAK_FAILURE_THRESHOLD);
}
