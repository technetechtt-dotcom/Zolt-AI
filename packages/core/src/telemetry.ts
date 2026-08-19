import {
  PHYSICAL_RANGES,
  TelemetryEnvelopeSchema,
  type ZoltTelemetryEnvelope,
} from "@zolt/contracts";

export interface TelemetryValidationResult {
  envelope?: ZoltTelemetryEnvelope;
  errors: string[];
  stale: boolean;
  delayed: boolean;
  outOfOrder: boolean;
}

export interface TelemetryValidationProfile {
  physicalRanges?: Record<string, { min: number; max: number; unit?: string }>;
}

const CLOCK_DRIFT_MS = Number(process.env.ZOLT_CLOCK_DRIFT_MS ?? 5 * 60_000);
const STALE_MS = Number(process.env.ZOLT_STALE_TELEMETRY_MS ?? 15 * 60_000);
const DELAYED_MS = Number(process.env.ZOLT_DELAYED_TELEMETRY_MS ?? 2 * 60_000);

export function validateTelemetryEnvelope(
  input: unknown,
  previousSequence?: number,
  profile?: TelemetryValidationProfile,
): TelemetryValidationResult {
  const parsed = TelemetryEnvelopeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      errors: parsed.error.issues.map((issue) => issue.message),
      stale: false,
      delayed: false,
      outOfOrder: false,
    };
  }

  const envelope = parsed.data;
  const errors: string[] = [];
  const source = Date.parse(envelope.sourceTimestamp);
  const received = Date.parse(envelope.receivedTimestamp);
  if (!Number.isFinite(source) || !Number.isFinite(received)) {
    errors.push("impossible timestamps");
  }
  if (source > received + CLOCK_DRIFT_MS) {
    errors.push(
      "source timestamp ahead of received timestamp beyond clock-drift tolerance",
    );
  }
  if (source < received - 365 * 24 * 3600_000) {
    errors.push("source timestamp impossibly old");
  }

  for (const measurement of envelope.measurements) {
    if (typeof measurement.value === "number") {
      const configuredRange =
        measurement.minimumExpected !== undefined ||
        measurement.maximumExpected !== undefined
          ? {
              min: measurement.minimumExpected ?? Number.NEGATIVE_INFINITY,
              max: measurement.maximumExpected ?? Number.POSITIVE_INFINITY,
              unit: measurement.unit,
            }
          : undefined;
      const range =
        profile?.physicalRanges?.[measurement.key] ??
        configuredRange ??
        PHYSICAL_RANGES[measurement.key];
      if (
        range &&
        (measurement.value < range.min || measurement.value > range.max)
      ) {
        errors.push(`physical range violated for ${measurement.key}`);
      }
      if (measurement.unit && range?.unit && measurement.unit !== range.unit) {
        errors.push(`unit mismatch for ${measurement.key}`);
      }
    }
  }

  const stale = Number.isFinite(source) && received - source > STALE_MS;
  const delayed = Number.isFinite(source) && received - source > DELAYED_MS;
  const outOfOrder =
    previousSequence !== undefined &&
    envelope.sequenceNumber !== undefined &&
    envelope.sequenceNumber < previousSequence;

  return { envelope, errors, stale, delayed, outOfOrder };
}
