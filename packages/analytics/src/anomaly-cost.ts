export interface LabeledScore {
  score: number;
  anomalous: boolean;
  category?: string;
  leadTimeMinutes?: number;
}

export interface ThresholdSweepResult {
  threshold: number;
  precision: number;
  recall: number;
  f1: number;
  falsePositiveRate: number;
  expectedCost: number;
  meanLeadTimeMinutes: number;
}

function metricsAtThreshold(
  rows: LabeledScore[],
  threshold: number,
  falseAlarmCost: number,
  missCost: number,
): ThresholdSweepResult {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  const leads: number[] = [];
  for (const row of rows) {
    const predicted = row.score >= threshold;
    if (predicted && row.anomalous) {
      tp += 1;
      if (row.leadTimeMinutes !== undefined) leads.push(row.leadTimeMinutes);
    } else if (predicted && !row.anomalous) fp += 1;
    else if (!predicted && !row.anomalous) tn += 1;
    else fn += 1;
  }
  const precision = tp / Math.max(tp + fp, 1);
  const recall = tp / Math.max(tp + fn, 1);
  const f1 = (2 * precision * recall) / Math.max(precision + recall, 1e-9);
  const falsePositiveRate = fp / Math.max(fp + tn, 1);
  return {
    threshold,
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1: Number(f1.toFixed(4)),
    falsePositiveRate: Number(falsePositiveRate.toFixed(4)),
    expectedCost: Number((fp * falseAlarmCost + fn * missCost).toFixed(2)),
    meanLeadTimeMinutes: Number(
      (leads.reduce((sum, value) => sum + value, 0) / Math.max(leads.length, 1)).toFixed(1),
    ),
  };
}

export function tuneAnomalyThreshold(
  rows: LabeledScore[],
  options: { falseAlarmCost?: number; missCost?: number } = {},
): {
  selected: ThresholdSweepResult;
  byCategory: Record<string, ThresholdSweepResult>;
  sweep: ThresholdSweepResult[];
} {
  const falseAlarmCost = options.falseAlarmCost ?? 1;
  const missCost = options.missCost ?? 8;
  const scores = [...new Set(rows.map((row) => row.score))].sort((a, b) => a - b);
  const candidates = scores.length ? scores : [0];
  const sweep = candidates.map((threshold) =>
    metricsAtThreshold(rows, threshold, falseAlarmCost, missCost),
  );
  const selected = sweep.reduce((best, current) =>
    current.expectedCost < best.expectedCost ||
    (current.expectedCost === best.expectedCost && current.f1 > best.f1)
      ? current
      : best,
  );
  const byCategory: Record<string, ThresholdSweepResult> = {};
  const categories = [...new Set(rows.map((row) => row.category ?? "uncategorised"))];
  for (const category of categories) {
    const subset = rows.filter((row) => (row.category ?? "uncategorised") === category);
    const categorySweep = candidates.map((threshold) =>
      metricsAtThreshold(subset, threshold, falseAlarmCost, missCost),
    );
    byCategory[category] = categorySweep.reduce((best, current) =>
      current.expectedCost < best.expectedCost ? current : best,
    );
  }
  return { selected, byCategory, sweep };
}
