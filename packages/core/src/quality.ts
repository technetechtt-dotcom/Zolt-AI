import type { ZoltTelemetryEnvelope } from "@zolt/contracts";

export interface TelemetryQualityReport {
  completenessScore: number;
  qualityScore: number;
  clockQualityScore: number;
  sourceTrustLevel: "LOW" | "MEDIUM" | "HIGH";
  issues: string[];
}

function numericSeries(
  telemetry: ZoltTelemetryEnvelope[],
  key: string,
): Array<{ value: number; time: number }> {
  return telemetry
    .flatMap((envelope) =>
      envelope.measurements
        .filter(
          (measurement) =>
            measurement.key === key && typeof measurement.value === "number",
        )
        .map((measurement) => ({
          value: measurement.value as number,
          time: Date.parse(envelope.sourceTimestamp),
        })),
    )
    .filter((item) => Number.isFinite(item.time))
    .sort((a, b) => a.time - b.time);
}

export function assessTelemetryQuality(input: {
  telemetry: ZoltTelemetryEnvelope[];
  expectedMeasurements?: string[];
  rateLimits?: Record<string, number>;
}): TelemetryQualityReport {
  const expected = input.expectedMeasurements ?? [
    "powerKw",
    "voltage",
    "frequencyHz",
  ];
  const present = new Set(
    input.telemetry.flatMap((envelope) =>
      envelope.measurements.map((measurement) => measurement.key),
    ),
  );
  const completenessScore =
    expected.length === 0
      ? 1
      : expected.filter((key) => present.has(key)).length / expected.length;
  const issues: string[] = [];
  let penalty = 0;

  for (const key of present) {
    const values = numericSeries(input.telemetry, key);
    if (values.length < 3) continue;
    const last = values.slice(-Math.min(6, values.length));
    if (last.every((item) => item.value === last[0]?.value)) {
      issues.push(`frozen-or-repeated:${key}`);
      penalty += 0.15;
    }
    const deltas = last
      .slice(1)
      .map((item, index) => item.value - last[index]!.value);
    if (
      deltas.length >= 3 &&
      deltas.every(
        (delta, index) =>
          index === 0 || Math.sign(delta) !== Math.sign(deltas[index - 1]!),
      ) &&
      deltas.every((delta) => Math.abs(delta) > 0)
    ) {
      issues.push(`rapid-oscillation:${key}`);
      penalty += 0.1;
    }
    const rateLimit = input.rateLimits?.[key];
    if (
      rateLimit !== undefined &&
      last.slice(1).some((item, index) => {
        const previous = last[index]!;
        const seconds = Math.max(1, (item.time - previous.time) / 1000);
        return Math.abs(item.value - previous.value) / seconds > rateLimit;
      })
    ) {
      issues.push(`unrealistic-rate-of-change:${key}`);
      penalty += 0.2;
    }
    if (last.length >= 5) {
      const firstMean =
        last.slice(0, 2).reduce((sum, item) => sum + item.value, 0) / 2;
      const finalMean =
        last.slice(-2).reduce((sum, item) => sum + item.value, 0) / 2;
      const span =
        Math.max(...last.map((item) => item.value)) -
        Math.min(...last.map((item) => item.value));
      if (span > 0 && Math.abs(finalMean - firstMean) / span > 0.8) {
        issues.push(`possible-sensor-drift:${key}`);
        penalty += 0.08;
      }
    }
  }

  const measurements = input.telemetry.flatMap(
    (envelope) => envelope.measurements,
  );
  const goodRatio =
    measurements.length === 0
      ? 0
      : measurements.filter((measurement) => measurement.quality === "GOOD")
          .length / measurements.length;
  const clockDrifts = input.telemetry
    .map((envelope) =>
      Math.abs(
        Date.parse(envelope.receivedTimestamp) -
          Date.parse(envelope.sourceTimestamp),
      ),
    )
    .filter(Number.isFinite);
  const meanDrift =
    clockDrifts.length === 0
      ? Number.POSITIVE_INFINITY
      : clockDrifts.reduce((sum, value) => sum + value, 0) / clockDrifts.length;
  const clockQualityScore = Math.max(
    0,
    Math.min(1, 1 - meanDrift / (15 * 60_000)),
  );
  const simulated = input.telemetry.some(
    (envelope) => envelope.simulated === true,
  );
  const sourceTrustLevel = simulated
    ? "LOW"
    : goodRatio >= 0.9 && clockQualityScore >= 0.8
      ? "HIGH"
      : "MEDIUM";
  const qualityScore = Math.max(
    0,
    Math.min(
      1,
      completenessScore * 0.35 +
        goodRatio * 0.4 +
        clockQualityScore * 0.25 -
        penalty,
    ),
  );
  return {
    completenessScore: Number(completenessScore.toFixed(3)),
    qualityScore: Number(qualityScore.toFixed(3)),
    clockQualityScore: Number(clockQualityScore.toFixed(3)),
    sourceTrustLevel,
    issues,
  };
}
