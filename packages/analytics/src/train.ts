function solarForecastKw(capacityKw: number, hourUtc: number, cloudFactor = 0.2): number {
  const daylight = Math.max(0, Math.sin(((hourUtc - 6) / 12) * Math.PI));
  return Number((capacityKw * daylight * (1 - Math.min(cloudFactor, 0.9))).toFixed(3));
}

function forecastMetrics(
  actual: number[],
  predicted: number[],
): { mae: number; rmse: number; mape?: number; bias: number } {
  const count = Math.min(actual.length, predicted.length);
  if (count === 0) return { mae: 0, rmse: 0, bias: 0 };
  const errors = Array.from({ length: count }, (_, index) => (predicted[index] ?? 0) - (actual[index] ?? 0));
  const mae = errors.reduce((sum, error) => sum + Math.abs(error), 0) / count;
  const rmse = Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / count);
  const bias = errors.reduce((sum, error) => sum + error, 0) / count;
  return {
    mae: Number(mae.toFixed(4)),
    rmse: Number(rmse.toFixed(4)),
    bias: Number(bias.toFixed(4)),
  };
}

export interface PlantObservation {
  timestamp: string;
  plantId: string;
  hourUtc: number;
  capacityKw: number;
  cloudCover: number;
  irradianceWm2: number;
  temperatureC: number;
  powerKw: number;
  expectedPowerKw: number;
  voltage: number;
  frequencyHz: number;
  exportLimitKw: number;
  curtailedKw: number;
  inverterFault: boolean;
  operatorLabel: "healthy" | "anomaly" | "curtailed" | "fault";
}

export interface DatasetSplits<T> {
  train: T[];
  validation: T[];
  test: T[];
}

export interface TrainedForecastModel {
  name: "solar-clearsky-calibrated";
  version: string;
  intercept: number;
  cloudCoefficient: number;
  irradianceCoefficient: number;
  temperatureCoefficient: number;
  residualStdKw: number;
  trainWindow: { start: string; end: string };
  evaluation: {
    validation: ReturnType<typeof forecastMetrics>;
    test: ReturnType<typeof forecastMetrics>;
  };
  leakageControls: string[];
}

export interface TrainedAnomalyModel {
  name: "inverter-residual-zscore";
  version: string;
  residualMean: number;
  residualStd: number;
  temperatureMean: number;
  temperatureStd: number;
  threshold: number;
  evaluation: {
    validation: { precision: number; recall: number; f1: number };
    test: { precision: number; recall: number; f1: number };
  };
}

export function generatePilotPlantDataset(input?: {
  days?: number;
  plants?: string[];
  intervalMinutes?: number;
  seed?: number;
}): PlantObservation[] {
  const days = input?.days ?? 90;
  const plants = input?.plants ?? ["pilot-plant-a", "pilot-plant-b"];
  const intervalMinutes = input?.intervalMinutes ?? 60;
  const seed = input?.seed ?? 20261021;
  const rows: PlantObservation[] = [];
  const start = Date.parse("2026-07-01T00:00:00.000Z");
  const steps = Math.floor((days * 24 * 60) / intervalMinutes);
  for (let index = 0; index < steps; index += 1) {
    const timestamp = new Date(start + index * intervalMinutes * 60_000);
    const hourUtc = timestamp.getUTCHours();
    for (const [plantOffset, plantId] of plants.entries()) {
      const rng = mulberry32(seed + index * 17 + plantOffset * 97);
      const capacityKw = plantId.endsWith("a") ? 250 : 180;
      const exportLimitKw = plantId.endsWith("a") ? 180 : 140;
      const cloudCover = clamp(0.12 + 0.35 * seasonalCloud(hourUtc, timestamp.getUTCDay()) + (rng() - 0.5) * 0.2);
      const irradianceWm2 = Math.max(0, 1000 * Math.max(0, Math.sin(((hourUtc - 6) / 12) * Math.PI)) * (1 - cloudCover));
      const temperatureC = 18 + 10 * Math.max(0, Math.sin(((hourUtc - 7) / 14) * Math.PI)) + (rng() - 0.5) * 2;
      const expectedPowerKw = solarForecastKw(capacityKw, hourUtc, cloudCover);
      const inverterFault = rng() < 0.04 && hourUtc >= 8 && hourUtc <= 16;
      const derate = inverterFault ? 0.35 + rng() * 0.2 : 1;
      const noise = (rng() - 0.5) * capacityKw * 0.03;
      const unconstrained = Math.max(0, expectedPowerKw * derate + noise);
      const curtailedKw = Math.max(0, unconstrained - exportLimitKw);
      const powerKw = unconstrained - curtailedKw;
      const operatorLabel = inverterFault
        ? "fault"
        : curtailedKw > 5
          ? "curtailed"
          : powerKw < expectedPowerKw * 0.55 && hourUtc >= 9 && hourUtc <= 15
            ? "anomaly"
            : "healthy";
      rows.push({
        timestamp: timestamp.toISOString(),
        plantId,
        hourUtc,
        capacityKw,
        cloudCover: Number(cloudCover.toFixed(3)),
        irradianceWm2: Number(irradianceWm2.toFixed(1)),
        temperatureC: Number(temperatureC.toFixed(2)),
        powerKw: Number(powerKw.toFixed(3)),
        expectedPowerKw: Number(expectedPowerKw.toFixed(3)),
        voltage: Number((400 + (rng() - 0.5) * 6).toFixed(2)),
        frequencyHz: Number((50 + (rng() - 0.5) * 0.08).toFixed(3)),
        exportLimitKw,
        curtailedKw: Number(curtailedKw.toFixed(3)),
        inverterFault,
        operatorLabel,
      });
    }
  }
  return rows;
}

export function timeSplit<T extends { timestamp: string }>(
  rows: T[],
  ratios = { train: 0.7, validation: 0.15, test: 0.15 },
): DatasetSplits<T> {
  const ordered = [...rows].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const times = [...new Set(ordered.map((row) => row.timestamp))];
  const trainEnd = Math.floor(times.length * ratios.train);
  const validationEnd = trainEnd + Math.floor(times.length * ratios.validation);
  const trainTimes = new Set(times.slice(0, trainEnd));
  const validationTimes = new Set(times.slice(trainEnd, validationEnd));
  const testTimes = new Set(times.slice(validationEnd));
  return {
    train: ordered.filter((row) => trainTimes.has(row.timestamp)),
    validation: ordered.filter((row) => validationTimes.has(row.timestamp)),
    test: ordered.filter((row) => testTimes.has(row.timestamp)),
  };
}

export function assertNoTimeLeakage<T extends { timestamp: string }>(splits: DatasetSplits<T>): void {
  const lastTrain = maxTime(splits.train);
  const firstValidation = minTime(splits.validation);
  const lastValidation = maxTime(splits.validation);
  const firstTest = minTime(splits.test);
  if (lastTrain && firstValidation && lastTrain >= firstValidation) {
    throw new Error("LEAKAGE_TRAIN_VALIDATION_OVERLAP");
  }
  if (lastValidation && firstTest && lastValidation >= firstTest) {
    throw new Error("LEAKAGE_VALIDATION_TEST_OVERLAP");
  }
}

export function trainForecastModel(
  splits: DatasetSplits<PlantObservation>,
  version = "solar-clearsky-calibrated-v1",
): TrainedForecastModel {
  assertNoTimeLeakage(splits);
  const design = splits.train.map((row) => features(row));
  const target = splits.train.map((row) => row.powerKw);
  const weights = fitLeastSquares(design, target);
  const predict = (row: PlantObservation) =>
    Math.max(0, dot(features(row), weights));
  const residuals = splits.train.map((row, index) => target[index]! - predict(row));
  const residualStdKw = std(residuals);
  return {
    name: "solar-clearsky-calibrated",
    version,
    intercept: weights[0] ?? 0,
    cloudCoefficient: weights[1] ?? 0,
    irradianceCoefficient: weights[2] ?? 0,
    temperatureCoefficient: weights[3] ?? 0,
    residualStdKw,
    trainWindow: {
      start: splits.train[0]?.timestamp ?? "",
      end: splits.train[splits.train.length - 1]?.timestamp ?? "",
    },
    evaluation: {
      validation: forecastMetrics(
        splits.validation.map((row) => row.powerKw),
        splits.validation.map((row) => predict(row)),
      ),
      test: forecastMetrics(
        splits.test.map((row) => row.powerKw),
        splits.test.map((row) => predict(row)),
      ),
    },
    leakageControls: [
      "Time-ordered split with no overlapping timestamps",
      "Least-squares coefficients fitted on the train window only",
      "Residual standard deviation estimated from train residuals only",
    ],
  };
}

export function predictForecastKw(
  model: TrainedForecastModel,
  row: Pick<
    PlantObservation,
    "hourUtc" | "capacityKw" | "cloudCover" | "irradianceWm2" | "temperatureC"
  >,
): number {
  const baseline = solarForecastKw(row.capacityKw, row.hourUtc, row.cloudCover);
  const value =
    model.intercept * baseline +
    model.cloudCoefficient * row.cloudCover +
    model.irradianceCoefficient * (row.irradianceWm2 / 1000) +
    model.temperatureCoefficient * ((row.temperatureC - 25) / 10);
  return Number(Math.max(0, Math.min(row.capacityKw, value)).toFixed(3));
}

export function trainAnomalyModel(
  splits: DatasetSplits<PlantObservation>,
  version = "inverter-residual-zscore-v1",
): TrainedAnomalyModel {
  assertNoTimeLeakage(splits);
  const residuals = splits.train.map((row) => row.powerKw - row.expectedPowerKw);
  const temperatures = splits.train.map((row) => row.temperatureC);
  const residualMean = mean(residuals);
  const residualStd = std(residuals) || 1;
  const temperatureMean = mean(temperatures);
  const temperatureStd = std(temperatures) || 1;
  const evaluate = (rows: PlantObservation[], threshold: number) => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const row of rows) {
      const residualZ = Math.abs((row.powerKw - row.expectedPowerKw - residualMean) / residualStd);
      const tempZ = Math.abs((row.temperatureC - temperatureMean) / temperatureStd);
      const predicted = residualZ > threshold || (tempZ > threshold && residualZ > 1.2);
      const actual = row.operatorLabel === "fault" || row.operatorLabel === "anomaly";
      if (predicted && actual) tp += 1;
      else if (predicted && !actual) fp += 1;
      else if (!predicted && actual) fn += 1;
    }
    const precision = tp / Math.max(tp + fp, 1);
    const recall = tp / Math.max(tp + fn, 1);
    const f1 = (2 * precision * recall) / Math.max(precision + recall, 1e-9);
    return {
      precision: Number(precision.toFixed(4)),
      recall: Number(recall.toFixed(4)),
      f1: Number(f1.toFixed(4)),
    };
  };
  let threshold = 2.5;
  let bestF1 = -1;
  for (const candidate of [2.2, 2.5, 3, 3.5, 4, 4.5, 5]) {
    const scored = evaluate(splits.train, candidate);
    if (scored.f1 > bestF1) {
      bestF1 = scored.f1;
      threshold = candidate;
    }
  }
  return {
    name: "inverter-residual-zscore",
    version,
    residualMean,
    residualStd,
    temperatureMean,
    temperatureStd,
    threshold,
    evaluation: {
      validation: evaluate(splits.validation, threshold),
      test: evaluate(splits.test, threshold),
    },
  };
}

export function scoreAnomaly(
  model: TrainedAnomalyModel,
  row: Pick<PlantObservation, "powerKw" | "expectedPowerKw" | "temperatureC">,
): { residualZ: number; temperatureZ: number; anomaly: boolean } {
  const residualZ =
    (row.powerKw - row.expectedPowerKw - model.residualMean) / model.residualStd;
  const temperatureZ = (row.temperatureC - model.temperatureMean) / model.temperatureStd;
  return {
    residualZ,
    temperatureZ,
    anomaly:
      Math.abs(residualZ) > model.threshold ||
      (Math.abs(temperatureZ) > model.threshold && Math.abs(residualZ) > 1.2),
  };
}

function features(row: PlantObservation): number[] {
  const baseline = solarForecastKw(row.capacityKw, row.hourUtc, row.cloudCover);
  return [
    baseline,
    row.cloudCover,
    row.irradianceWm2 / 1000,
    (row.temperatureC - 25) / 10,
  ];
}

function fitLeastSquares(x: number[][], y: number[]): number[] {
  const cols = x[0]?.length ?? 0;
  const xtx = Array.from({ length: cols }, () => Array.from({ length: cols }, () => 0));
  const xty = Array.from({ length: cols }, () => 0);
  for (let row = 0; row < x.length; row += 1) {
    for (let i = 0; i < cols; i += 1) {
      xty[i] = (xty[i] ?? 0) + (x[row]?.[i] ?? 0) * (y[row] ?? 0);
      for (let j = 0; j < cols; j += 1) {
        xtx[i]![j] = (xtx[i]![j] ?? 0) + (x[row]?.[i] ?? 0) * (x[row]?.[j] ?? 0);
      }
    }
  }
  return solve(xtx, xty);
}

function solve(matrix: number[][], vector: number[]): number[] {
  const n = vector.length;
  const a = matrix.map((row, index) => [...row, vector[index] ?? 0]);
  for (let i = 0; i < n; i += 1) {
    let pivot = i;
    for (let r = i + 1; r < n; r += 1) {
      if (Math.abs(a[r]?.[i] ?? 0) > Math.abs(a[pivot]?.[i] ?? 0)) pivot = r;
    }
    const swap = a[i];
    a[i] = a[pivot]!;
    a[pivot] = swap!;
    const denom = a[i]?.[i] ?? 1;
    for (let c = i; c <= n; c += 1) a[i]![c] = (a[i]?.[c] ?? 0) / (denom || 1);
    for (let r = 0; r < n; r += 1) {
      if (r === i) continue;
      const factor = a[r]?.[i] ?? 0;
      for (let c = i; c <= n; c += 1) a[r]![c] = (a[r]?.[c] ?? 0) - factor * (a[i]?.[c] ?? 0);
    }
  }
  return a.map((row) => row[n] ?? 0);
}

function dot(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function std(values: number[]): number {
  const average = mean(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
      Math.max(values.length, 1),
  );
}

function maxTime<T extends { timestamp: string }>(rows: T[]): number | undefined {
  if (!rows.length) return undefined;
  return Math.max(...rows.map((row) => Date.parse(row.timestamp)));
}

function minTime<T extends { timestamp: string }>(rows: T[]): number | undefined {
  if (!rows.length) return undefined;
  return Math.min(...rows.map((row) => Date.parse(row.timestamp)));
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function seasonalCloud(hourUtc: number, day: number): number {
  return 0.5 + 0.5 * Math.sin(((hourUtc + day) / 24) * Math.PI * 2);
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function residualZ(values: number[]): number[] {
  const average = mean(values);
  const deviation = std(values) || 1;
  return values.map((value) => (value - average) / deviation);
}
