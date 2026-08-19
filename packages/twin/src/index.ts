export type TwinAssetType =
  "inverter" | "meter" | "battery" | "load" | "electrolyser" | "grid" | "other";

export interface OperatingLimit {
  min?: number;
  max?: number;
  unit?: string;
}

export interface TwinAsset {
  id: string;
  type: TwinAssetType;
  capacityKw?: number;
  ratedCapacityKw?: number;
  limits?: Record<string, number>;
  operatingLimits?: Record<string, OperatingLimit>;
}

export interface TwinRelationship {
  from: string;
  to: string;
  relation: "feeds" | "meters" | "contains" | "charges" | "supplies" | string;
}

export interface TwinAssetState {
  assetId: string;
  observedAt: string;
  source: "LIVE" | "SIMULATED";
  values: Record<string, number>;
}

export interface InstallationTwin {
  tenantId: string;
  installationId: string;
  /** Retained for compatibility. False always means this is a scenario copy. */
  live: boolean;
  assets: TwinAsset[];
  topology: TwinRelationship[];
  liveState?: TwinAssetState[];
  simulatedState?: TwinAssetState[];
  scenarioId?: string;
  simulatedAt?: string;
}

function assertFiniteValues(values: Record<string, number>): void {
  if (Object.values(values).some((value) => !Number.isFinite(value))) {
    throw new Error("TWIN_STATE_INVALID");
  }
}

function validateTopology(
  assets: TwinAsset[],
  topology: TwinRelationship[],
): void {
  const ids = new Set<string>();
  for (const asset of assets) {
    if (!asset.id || ids.has(asset.id))
      throw new Error("TWIN_ASSET_ID_INVALID");
    ids.add(asset.id);
  }
  for (const edge of topology) {
    if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) {
      throw new Error("TWIN_TOPOLOGY_INVALID");
    }
  }
}

export function createTwin(
  input: Omit<InstallationTwin, "live"> & { live?: boolean },
): InstallationTwin {
  if (!input.tenantId || !input.installationId) {
    throw new Error("TWIN_SCOPE_REQUIRED");
  }
  validateTopology(input.assets, input.topology);
  if (input.liveState?.some((state) => state.source !== "LIVE")) {
    throw new Error("SIMULATED_STATE_CANNOT_BE_LIVE");
  }
  if (input.simulatedState?.some((state) => state.source !== "SIMULATED")) {
    throw new Error("LIVE_STATE_CANNOT_BE_SIMULATED");
  }
  return {
    ...input,
    live: input.live === true,
    liveState: input.liveState ? structuredClone(input.liveState) : [],
    simulatedState: input.simulatedState
      ? structuredClone(input.simulatedState)
      : [],
  };
}

export function applyLiveState(
  twin: InstallationTwin,
  update: Omit<TwinAssetState, "source">,
): InstallationTwin {
  if (!twin.assets.some((asset) => asset.id === update.assetId)) {
    throw new Error("TWIN_ASSET_NOT_FOUND");
  }
  assertFiniteValues(update.values);
  const next: TwinAssetState = { ...structuredClone(update), source: "LIVE" };
  return {
    ...twin,
    live: true,
    liveState: [
      ...(twin.liveState ?? []).filter(
        (state) => state.assetId !== update.assetId,
      ),
      next,
    ],
  };
}

export function simulateScenario(
  twin: InstallationTwin,
  overrides: Record<string, number>,
  options: {
    scenarioId?: string;
    assetOverrides?: Record<string, Record<string, number>>;
    simulatedAt?: string;
  } = {},
): InstallationTwin {
  assertFiniteValues(overrides);
  const simulatedAt = options.simulatedAt ?? new Date().toISOString();
  const prior = new Map(
    (twin.liveState ?? []).map((state) => [state.assetId, state.values]),
  );
  const simulatedState = twin.assets.map((asset) => {
    const values = {
      ...(prior.get(asset.id) ?? {}),
      ...overrides,
      ...(options.assetOverrides?.[asset.id] ?? {}),
    };
    assertFiniteValues(values);
    return {
      assetId: asset.id,
      observedAt: simulatedAt,
      source: "SIMULATED" as const,
      values,
    };
  });
  return {
    ...structuredClone(twin),
    live: false,
    scenarioId: options.scenarioId ?? `scenario-${Date.now()}`,
    simulatedAt,
    simulatedState,
    assets: twin.assets.map((asset) => ({
      ...asset,
      limits: { ...asset.limits, ...overrides },
    })),
  };
}

export function compareScenario(
  liveTwin: InstallationTwin,
  scenarioTwin: InstallationTwin,
): Record<string, { live: number; simulated: number; delta: number }> {
  if (
    liveTwin.tenantId !== scenarioTwin.tenantId ||
    liveTwin.installationId !== scenarioTwin.installationId
  ) {
    throw new Error("TWIN_SCOPE_MISMATCH");
  }
  if (scenarioTwin.live || !scenarioTwin.scenarioId) {
    throw new Error("TWIN_SCENARIO_REQUIRED");
  }
  const liveTotals = new Map<string, number>();
  const simulatedTotals = new Map<string, number>();
  for (const state of liveTwin.liveState ?? []) {
    for (const [key, value] of Object.entries(state.values)) {
      liveTotals.set(key, (liveTotals.get(key) ?? 0) + value);
    }
  }
  for (const state of scenarioTwin.simulatedState ?? []) {
    for (const [key, value] of Object.entries(state.values)) {
      simulatedTotals.set(key, (simulatedTotals.get(key) ?? 0) + value);
    }
  }
  const result: Record<
    string,
    { live: number; simulated: number; delta: number }
  > = {};
  for (const key of new Set([
    ...liveTotals.keys(),
    ...simulatedTotals.keys(),
  ])) {
    const live = liveTotals.get(key) ?? 0;
    const simulated = simulatedTotals.get(key) ?? 0;
    result[key] = { live, simulated, delta: simulated - live };
  }
  return result;
}
