import { describe, expect, it } from "vitest";
import {
  applyLiveState,
  compareScenario,
  createTwin,
  simulateScenario,
} from "../packages/twin/src/index.js";

const base = () =>
  createTwin({
    tenantId: "tenant-a",
    installationId: "site-a",
    live: true,
    assets: [
      { id: "meter", type: "meter" },
      { id: "inverter", type: "inverter", ratedCapacityKw: 100 },
    ],
    topology: [{ from: "inverter", to: "meter", relation: "feeds" }],
  });

describe("digital twin", () => {
  it("validates topology references", () => {
    expect(() =>
      createTwin({
        tenantId: "tenant-a",
        installationId: "site-a",
        assets: [{ id: "meter", type: "meter" }],
        topology: [{ from: "unknown", to: "meter", relation: "feeds" }],
      }),
    ).toThrow("TWIN_TOPOLOGY_INVALID");
  });

  it("keeps live and simulated state explicitly separated", () => {
    const live = applyLiveState(base(), {
      assetId: "inverter",
      observedAt: "2026-08-12T12:00:00.000Z",
      values: { powerKw: 70 },
    });
    const scenario = simulateScenario(
      live,
      {},
      {
        scenarioId: "curtailment-off",
        simulatedAt: "2026-08-12T12:01:00.000Z",
        assetOverrides: { inverter: { powerKw: 90 } },
      },
    );
    expect(live.liveState?.[0]?.source).toBe("LIVE");
    expect(scenario.live).toBe(false);
    expect(
      scenario.simulatedState?.every((state) => state.source === "SIMULATED"),
    ).toBe(true);
    expect(compareScenario(live, scenario).powerKw).toEqual({
      live: 70,
      simulated: 90,
      delta: 20,
    });
  });

  it("refuses cross-tenant scenario comparison", () => {
    const live = base();
    const scenario = simulateScenario(
      { ...live, tenantId: "tenant-b" },
      { powerKw: 10 },
    );
    expect(() => compareScenario(live, scenario)).toThrow(
      "TWIN_SCOPE_MISMATCH",
    );
  });
});
