export interface TwinAsset {
  id: string;
  type: "inverter" | "meter" | "battery" | "load" | "other";
  capacityKw?: number;
  limits?: Record<string, number>;
}

export interface InstallationTwin {
  tenantId: string;
  installationId: string;
  live: boolean;
  assets: TwinAsset[];
  topology: Array<{ from: string; to: string; relation: string }>;
}

export function createTwin(input: Omit<InstallationTwin, "live"> & { live?: boolean }): InstallationTwin {
  return { ...input, live: input.live === true };
}

export function simulateScenario(twin: InstallationTwin, overrides: Record<string, number>): InstallationTwin {
  return {
    ...twin,
    live: false,
    assets: twin.assets.map((asset) => ({
      ...asset,
      limits: { ...asset.limits, ...overrides }
    }))
  };
}
