import { assertNoPlantCommand } from "@zolt/safety";

const CORPUS: Array<{ id: string; title: string; text: string }> = [
  {
    id: "safety",
    title: "Safety policy",
    text: "Zolt is advisory-only. It must not issue plant commands, breaker operations, or setpoint writes. Physical actuation stays outside Zolt until HIL and pilot validation are complete."
  },
  {
    id: "tenancy",
    title: "Tenancy model",
    text: "Every query is bound to the authenticated tenant. Credentials, telemetry, recommendations and retrieval cannot cross tenant boundaries."
  },
  {
    id: "curtailment",
    title: "Curtailment",
    text: "Curtailment risk is raised when forecast or live export exceeds the configured export limit. Operators should review storage dispatch or flexible load as advisory options."
  },
  {
    id: "telemetry",
    title: "Telemetry quality",
    text: "Stale, delayed, out-of-order, simulated or poor-quality measurements reduce confidence and can downgrade high-risk recommendations."
  }
];

export async function askCopilot(input: {
  tenantId: string;
  question: string;
  permissions: string[];
}): Promise<{ answer: string; citations: Array<{ id: string; title: string }>; tenantId: string }> {
  assertNoPlantCommand(input.question);
  if (!input.permissions.includes("recommendation:read") && !input.permissions.includes("admin:manage")) {
    throw new Error("FORBIDDEN");
  }
  const terms = input.question.toLowerCase().split(/\W+/).filter((item) => item.length > 3);
  const ranked = CORPUS.map((doc) => ({
    doc,
    score: terms.reduce((sum, term) => sum + (doc.text.toLowerCase().includes(term) ? 1 : 0), 0)
  }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const selected = ranked.slice(0, 3).map((item) => item.doc);
  const answer =
    selected.length === 0
      ? "I do not have enough tenant-bound evidence to answer. Ask about telemetry, curtailment, recommendations or safety policy."
      : selected.map((doc) => `${doc.title}: ${doc.text}`).join(" ");

  return {
    tenantId: input.tenantId,
    answer: `${answer} This assistant cannot issue plant commands.`,
    citations: selected.map((doc) => ({ id: doc.id, title: doc.title }))
  };
}
