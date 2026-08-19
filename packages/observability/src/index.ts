import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";

type Labels = Record<string, string | number | boolean>;

interface MetricValue {
  labels: Record<string, string>;
  value: number;
}

interface HistogramValue extends MetricValue {
  count: number;
  buckets: number[];
}

const DEFAULT_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000];

function metricName(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9_:]/g, "_");
  if (!/^[a-zA-Z_:]/.test(normalized)) throw new Error("METRIC_NAME_INVALID");
  return normalized;
}

function normalizedLabels(labels: Labels = {}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(labels)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [
        metricName(key),
        String(value).replace(
          /[\n\\"]/g,
          (match) => `\\${match === "\n" ? "n" : match}`,
        ),
      ]),
  );
}

function labelsKey(labels: Record<string, string>): string {
  return JSON.stringify(labels);
}

function renderLabels(
  labels: Record<string, string>,
  extra?: [string, string],
): string {
  const entries = [...Object.entries(labels), ...(extra ? [extra] : [])];
  return entries.length === 0
    ? ""
    : `{${entries.map(([key, value]) => `${key}="${value}"`).join(",")}}`;
}

export class MetricsRegistry {
  private readonly counters = new Map<string, Map<string, MetricValue>>();
  private readonly gauges = new Map<string, Map<string, MetricValue>>();
  private readonly histograms = new Map<string, Map<string, HistogramValue>>();

  increment(name: string, labels: Labels = {}, amount = 1): void {
    if (!Number.isFinite(amount) || amount < 0)
      throw new Error("COUNTER_VALUE_INVALID");
    this.mutate(
      this.counters,
      metricName(name),
      labels,
      (current) => current + amount,
    );
  }

  gauge(name: string, value: number, labels: Labels = {}): void {
    if (!Number.isFinite(value)) throw new Error("GAUGE_VALUE_INVALID");
    this.mutate(this.gauges, metricName(name), labels, () => value);
  }

  observe(name: string, value: number, labels: Labels = {}): void {
    if (!Number.isFinite(value) || value < 0)
      throw new Error("HISTOGRAM_VALUE_INVALID");
    const safeName = metricName(name);
    const safeLabels = normalizedLabels(labels);
    const group =
      this.histograms.get(safeName) ?? new Map<string, HistogramValue>();
    const key = labelsKey(safeLabels);
    const current = group.get(key) ?? {
      labels: safeLabels,
      value: 0,
      count: 0,
      buckets: DEFAULT_BUCKETS.map(() => 0),
    };
    current.value += value;
    current.count += 1;
    DEFAULT_BUCKETS.forEach((bucket, index) => {
      if (value <= bucket) {
        current.buckets[index] = (current.buckets[index] ?? 0) + 1;
      }
    });
    group.set(key, current);
    this.histograms.set(safeName, group);
  }

  renderPrometheus(): string {
    const lines: string[] = [];
    for (const [name, values] of [...this.counters.entries()].sort()) {
      lines.push(`# TYPE ${name} counter`);
      for (const item of values.values())
        lines.push(`${name}${renderLabels(item.labels)} ${item.value}`);
    }
    for (const [name, values] of [...this.gauges.entries()].sort()) {
      lines.push(`# TYPE ${name} gauge`);
      for (const item of values.values())
        lines.push(`${name}${renderLabels(item.labels)} ${item.value}`);
    }
    for (const [name, values] of [...this.histograms.entries()].sort()) {
      lines.push(`# TYPE ${name} histogram`);
      for (const item of values.values()) {
        DEFAULT_BUCKETS.forEach((bucket, index) =>
          lines.push(
            `${name}_bucket${renderLabels(item.labels, ["le", String(bucket)])} ${item.buckets[index]}`,
          ),
        );
        lines.push(
          `${name}_bucket${renderLabels(item.labels, ["le", "+Inf"])} ${item.count}`,
        );
        lines.push(`${name}_sum${renderLabels(item.labels)} ${item.value}`);
        lines.push(`${name}_count${renderLabels(item.labels)} ${item.count}`);
      }
    }
    return `${lines.join("\n")}\n`;
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }

  private mutate(
    registry: Map<string, Map<string, MetricValue>>,
    name: string,
    labels: Labels,
    update: (current: number) => number,
  ): void {
    const safeLabels = normalizedLabels(labels);
    const group = registry.get(name) ?? new Map<string, MetricValue>();
    const key = labelsKey(safeLabels);
    const current = group.get(key) ?? { labels: safeLabels, value: 0 };
    current.value = update(current.value);
    group.set(key, current);
    registry.set(name, group);
  }
}

export const metrics = new MetricsRegistry();

interface TraceContext {
  traceId: string;
  spanId: string;
}

const traceStorage = new AsyncLocalStorage<TraceContext>();

function newHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

export function currentTraceContext(): TraceContext | undefined {
  return traceStorage.getStore();
}

export async function withSpan<T>(
  name: string,
  operation: () => Promise<T>,
  parent?: Partial<TraceContext>,
): Promise<T> {
  const context = {
    traceId: parent?.traceId ?? currentTraceContext()?.traceId ?? newHex(16),
    spanId: newHex(8),
  };
  const started = performance.now();
  return traceStorage.run(context, async () => {
    try {
      const result = await operation();
      metrics.observe("zolt_span_duration_ms", performance.now() - started, {
        name,
        status: "ok",
      });
      return result;
    } catch (error) {
      metrics.observe("zolt_span_duration_ms", performance.now() - started, {
        name,
        status: "error",
      });
      throw error;
    }
  });
}

export function instrumentFastify(app: FastifyInstance, service: string): void {
  const starts = new WeakMap<FastifyRequest, number>();
  metrics.gauge("zolt_service_info", 1, { service });
  app.addHook("onRequest", async (request, reply) => {
    starts.set(request, performance.now());
    reply.header("x-correlation-id", correlationIdFromRequest(request));
  });
  app.addHook("onResponse", async (request, reply) => {
    const started = starts.get(request) ?? performance.now();
    const labels = {
      service,
      method: request.method,
      route: request.routeOptions.url ?? "unmatched",
      status: reply.statusCode,
    };
    metrics.increment("zolt_http_requests_total", labels);
    metrics.observe(
      "zolt_http_request_duration_ms",
      performance.now() - started,
      labels,
    );
  });
  app.addHook("onError", async (request, _reply, error) => {
    metrics.increment("zolt_errors_total", {
      service,
      route: request.routeOptions.url ?? "unmatched",
      error: error.name,
    });
  });
}

export function correlationIdFromRequest(req: FastifyRequest): string {
  const existing = req.headers["x-correlation-id"];
  if (
    typeof existing === "string" &&
    existing.length > 0 &&
    existing.length <= 128
  ) {
    return existing;
  }
  return randomUUID();
}

export function logError(scope: string, error: unknown): void {
  const normalized = error instanceof Error ? error.message : String(error);
  const trace = currentTraceContext();
  console.error(
    JSON.stringify({
      level: "error",
      scope,
      message: normalized,
      ...trace,
      ts: new Date().toISOString(),
    }),
  );
}

export function logInfo(
  scope: string,
  details?: Record<string, unknown>,
): void {
  const trace = currentTraceContext();
  console.log(
    JSON.stringify({
      level: "info",
      scope,
      ...trace,
      ts: new Date().toISOString(),
      ...(details ?? {}),
    }),
  );
}
