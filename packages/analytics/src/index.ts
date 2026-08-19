export function rollingAverage(values: number[], window: number): number[] {
  return values.map((_, index) => {
    const slice = values.slice(Math.max(0, index - window + 1), index + 1);
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
}

export function rollingVariance(values: number[], window: number): number[] {
  const averages = rollingAverage(values, window);
  return values.map((value, index) => {
    const slice = values.slice(Math.max(0, index - window + 1), index + 1);
    const mean = averages[index] ?? 0;
    return (
      slice.reduce((sum, item) => sum + (item - mean) ** 2, 0) / slice.length
    );
  });
}

export function zScores(values: number[]): number[] {
  const mean =
    values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    Math.max(values.length, 1);
  const std = Math.sqrt(variance) || 1;
  return values.map((value) => (value - mean) / std);
}

export function linearTrend(values: number[]): {
  slope: number;
  intercept: number;
} {
  const n = values.length;
  if (n === 0) {
    return { slope: 0, intercept: 0 };
  }
  const sumX = (n * (n - 1)) / 2;
  const sumY = values.reduce((sum, value) => sum + value, 0);
  const sumXY = values.reduce((sum, value, index) => sum + index * value, 0);
  const sumXX = (n * (n - 1) * (2 * n - 1)) / 6;
  const slope =
    (n * sumXY - sumX * sumY) / Math.max(n * sumXX - sumX * sumX, 1);
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

export function detectChangePoint(values: number[]): number | undefined {
  if (values.length < 4) {
    return undefined;
  }
  const scores = zScores(values);
  const index = scores.findIndex((score) => Math.abs(score) > 2.5);
  return index >= 0 ? index : undefined;
}

export function pearson(left: number[], right: number[]): number {
  const n = Math.min(left.length, right.length);
  if (n === 0) {
    return 0;
  }
  const meanL = left.slice(0, n).reduce((sum, value) => sum + value, 0) / n;
  const meanR = right.slice(0, n).reduce((sum, value) => sum + value, 0) / n;
  let num = 0;
  let denL = 0;
  let denR = 0;
  for (let i = 0; i < n; i += 1) {
    const a = (left[i] ?? 0) - meanL;
    const b = (right[i] ?? 0) - meanR;
    num += a * b;
    denL += a * a;
    denR += b * b;
  }
  return num / Math.max(Math.sqrt(denL * denR), 1e-9);
}

export function seasonalBaseline(values: number[], season = 24): number[] {
  return values.map((_, index) => {
    const peers: number[] = [];
    for (let i = index % season; i < values.length; i += season) {
      if (i !== index) {
        peers.push(values[i] ?? 0);
      }
    }
    if (peers.length === 0) {
      return values[index] ?? 0;
    }
    return peers.reduce((sum, value) => sum + value, 0) / peers.length;
  });
}

export function solarForecastKw(
  capacityKw: number,
  hourUtc: number,
  cloudFactor = 0.2,
): number {
  const daylight = Math.max(0, Math.sin(((hourUtc - 6) / 12) * Math.PI));
  return Number(
    (capacityKw * daylight * (1 - Math.min(cloudFactor, 0.9))).toFixed(3),
  );
}

export function loadForecastKw(history: number[]): number {
  const avg = rollingAverage(history, Math.min(12, history.length));
  return avg[avg.length - 1] ?? 0;
}

export function curtailmentForecastKw(
  forecastKw: number,
  exportLimitKw: number,
): number {
  return Math.max(0, forecastKw - exportLimitKw);
}

export function inverterHealthScore(input: {
  temperatures: number[];
  power: number[];
  expectedPower: number[];
}): { score: number; remainingUsefulLifeDays: number; anomaly: boolean } {
  const tempZ = zScores(input.temperatures);
  const residual = input.power.map(
    (value, index) => value - (input.expectedPower[index] ?? value),
  );
  const residualZ = zScores(residual);
  const hot = tempZ.filter((value) => value > 2).length;
  const under = residualZ.filter((value) => value < -2).length;
  const score = Math.max(
    0.05,
    Math.min(0.99, 1 - (hot + under) / Math.max(input.power.length, 1)),
  );
  return {
    score,
    remainingUsefulLifeDays: Math.round(score * 1800),
    anomaly: score < 0.7,
  };
}

export function revenueLoss(energyKwh: number, tariff: number): number {
  return Number((energyKwh * tariff).toFixed(2));
}

export function forecastMetrics(
  actual: number[],
  predicted: number[],
): { mae: number; rmse: number; mape?: number; bias: number } {
  const count = Math.min(actual.length, predicted.length);
  if (count === 0) return { mae: 0, rmse: 0, bias: 0 };
  const errors = Array.from(
    { length: count },
    (_, index) => (predicted[index] ?? 0) - (actual[index] ?? 0),
  );
  const mae = errors.reduce((sum, error) => sum + Math.abs(error), 0) / count;
  const rmse = Math.sqrt(
    errors.reduce((sum, error) => sum + error ** 2, 0) / count,
  );
  const bias = errors.reduce((sum, error) => sum + error, 0) / count;
  const validPercentage = errors
    .map((error, index) => ({ error, actual: actual[index] ?? 0 }))
    .filter((row) => Math.abs(row.actual) > 1e-9);
  const mape = validPercentage.length
    ? validPercentage.reduce(
        (sum, row) => sum + Math.abs(row.error / row.actual),
        0,
      ) / validPercentage.length
    : undefined;
  return {
    mae: Number(mae.toFixed(4)),
    rmse: Number(rmse.toFixed(4)),
    ...(mape === undefined ? {} : { mape: Number(mape.toFixed(4)) }),
    bias: Number(bias.toFixed(4)),
  };
}

export function solarForecastWithConfidence(input: {
  capacityKw: number;
  hourUtc: number;
  cloudCover?: number;
  irradianceWm2?: number;
  temperatureC?: number;
  historicalErrorStdKw?: number;
}): {
  forecastKw: number;
  lowerKw: number;
  upperKw: number;
  baselineKw: number;
} {
  const cloudCover = Math.max(0, Math.min(1, input.cloudCover ?? 0.2));
  const baselineKw = solarForecastKw(
    input.capacityKw,
    input.hourUtc,
    cloudCover,
  );
  const irradianceFactor =
    input.irradianceWm2 === undefined
      ? 1
      : Math.max(0, Math.min(1.2, input.irradianceWm2 / 1000));
  const temperatureDerate =
    input.temperatureC === undefined
      ? 1
      : Math.max(0.7, 1 - Math.max(0, input.temperatureC - 25) * 0.004);
  const forecastKw = Math.max(
    0,
    Math.min(
      input.capacityKw,
      baselineKw * irradianceFactor * temperatureDerate,
    ),
  );
  const sigma =
    input.historicalErrorStdKw ??
    Math.max(input.capacityKw * (0.08 + cloudCover * 0.12), 1);
  return {
    forecastKw: Number(forecastKw.toFixed(3)),
    lowerKw: Number(Math.max(0, forecastKw - 1.96 * sigma).toFixed(3)),
    upperKw: Number(
      Math.min(input.capacityKw, forecastKw + 1.96 * sigma).toFixed(3),
    ),
    baselineKw,
  };
}
