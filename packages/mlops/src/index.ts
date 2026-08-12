export interface ModelCard {
  name: string;
  version: string;
  status: "candidate" | "champion" | "challenger" | "retired";
  metadata: Record<string, unknown>;
  evaluation?: Record<string, unknown>;
}

const registry = new Map<string, ModelCard>();

export function registerModel(card: ModelCard): void {
  registry.set(`${card.name}:${card.version}`, card);
}

export function getModel(name: string, version: string): ModelCard | undefined {
  return registry.get(`${name}:${version}`);
}

export function listModels(name?: string): ModelCard[] {
  return [...registry.values()].filter((card) => !name || card.name === name);
}

export function promoteChampion(name: string, version: string): void {
  for (const card of registry.values()) {
    if (card.name === name && card.status === "champion") {
      card.status = "retired";
    }
  }
  const target = getModel(name, version);
  if (target) {
    target.status = "champion";
  }
}
