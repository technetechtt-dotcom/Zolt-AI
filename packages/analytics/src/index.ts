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
    return slice.reduce((sum, item) => sum + (item - mean) ** 2, 0) / slice.length;
  });
}

export function zScores(values: number[]): number[] {
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(values.length, 1);
  const std = Math.sqrt(variance) || 1;
  return values.map((value) => (value - mean) / std);
}

export function linearTrend(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n === 0) {
    return { slope: 0, intercept: 0 };
  }
  const sumX = (n * (n - 1)) / 2;
  const sumY = values.reduce((sum, value) => sum + value, 0);
  const sumXY = values.reduce((sum, value, index) => sum + index * value, 0);
  const sumXX = (n * (n - 1) * (2 * n - 1)) / 6;
  const slope = (n * sumXY - sumX * sumY) / Math.max(n * sumXX - sumX * sumX, 1);
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
