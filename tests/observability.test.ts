import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import {
  instrumentFastify,
  MetricsRegistry,
} from "../packages/observability/src/index.js";

describe("observability", () => {
  it("renders counters, gauges and histograms as Prometheus text", () => {
    const registry = new MetricsRegistry();
    registry.increment("zolt_jobs_total", { queue: "telemetry" }, 2);
    registry.gauge("zolt_queue_depth", 4, { queue: "telemetry" });
    registry.observe("zolt_job_duration_ms", 25, { queue: "telemetry" });
    const output = registry.renderPrometheus();
    expect(output).toContain('zolt_jobs_total{queue="telemetry"} 2');
    expect(output).toContain('zolt_queue_depth{queue="telemetry"} 4');
    expect(output).toContain('zolt_job_duration_ms_count{queue="telemetry"} 1');
  });

  it("adds correlation IDs and records HTTP requests", async () => {
    const app = Fastify();
    instrumentFastify(app, "test-service");
    app.get("/probe", async () => ({ ok: true }));
    const response = await app.inject({ method: "GET", url: "/probe" });
    expect(response.headers["x-correlation-id"]).toBeTruthy();
    expect(response.statusCode).toBe(200);
    await app.close();
  });
});
