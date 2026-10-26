import { describe, expect, it } from "vitest";
import { tuneAnomalyThreshold } from "../packages/analytics/src/anomaly-cost.js";
import { scorePredictiveMaintenance } from "../packages/analytics/src/predictive-maintenance.js";
import { completeSiteTopology } from "../packages/twin/src/index.js";
import { rejectedDefaultCredentials } from "../packages/auth/src/security.js";

describe("industrial analytics and topology", () => {
  it("prefers missed-failure cost over false-alarm cost when misses are expensive", () => {
    const rows = [
      { score: 0.2, anomalous: false, category: "comms" },
      { score: 0.4, anomalous: false, category: "comms" },
      { score: 0.6, anomalous: true, category: "inverter", leadTimeMinutes: 12 },
      { score: 0.9, anomalous: true, category: "inverter", leadTimeMinutes: 30 },
    ];
    const tuned = tuneAnomalyThreshold(rows, { falseAlarmCost: 1, missCost: 20 });
    expect(tuned.selected.recall).toBeGreaterThanOrEqual(0.5);
    expect(tuned.byCategory.inverter).toBeDefined();
  });

  it("explains predictive maintenance with a health score and evidence", () => {
    const result = scorePredictiveMaintenance({
      temperatureTrendCPerHour: 1.2,
      powerDeratingPct: 12,
      repeatedFaultCount: 4,
      dcAcImbalancePct: 7,
      communicationsLossPct: 15,
      voltageAnomalyCount: 3,
      frequencyAnomalyCount: 2,
      efficiencyDeteriorationPct: 6,
      maintenanceOverdueDays: 20,
    });
    expect(result.advisoryOnly).toBe(true);
    expect(result.healthScore).toBeLessThan(80);
    expect(result.evidence.length).toBeGreaterThan(1);
  });

  it("builds a complete installation topology with an export point", () => {
    const twin = completeSiteTopology({
      tenantId: "tenant-demo",
      installationId: "installation-demo",
      inverters: [
        { id: "inv-1", capacityKw: 100 },
        { id: "inv-2", capacityKw: 100 },
      ],
      batteries: [{ id: "bess-1", capacityKw: 50 }],
      transformers: [{ id: "tx-1" }],
    });
    expect(twin.exportPointId).toBe("export-point");
    expect(twin.nominalCapacityKw).toBe(200);
    expect(twin.assets.some((asset) => asset.type === "transformer")).toBe(true);
  });

  it("rejects known development credentials in production env maps", () => {
    expect(
      rejectedDefaultCredentials({
        NODE_ENV: "production",
        ZOLT_SEED_ADMIN_PASSWORD: "ChangeMeNow!23",
        ZOLT_SEED_DEVELOPER_PASSWORD: "ZoltMaintain!24",
      } as NodeJS.ProcessEnv),
    ).toEqual(
      expect.arrayContaining([
        "ZOLT_SEED_ADMIN_PASSWORD",
        "ZOLT_SEED_DEVELOPER_PASSWORD",
      ]),
    );
  });
});
