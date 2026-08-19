import { assertNoPlantCommand } from "@zolt/safety";

export interface CopilotSource {
  id: string;
  title: string;
  text: string;
  tenantId?: string;
  requiredPermission?: string;
}

const CORPUS: CopilotSource[] = [
  {
    id: "safety",
    title: "Safety policy",
    text: "Zolt is advisory-only. It must not issue plant commands, breaker operations, or setpoint writes. Physical actuation stays outside Zolt until HIL and pilot validation are complete.",
  },
  {
    id: "tenancy",
    title: "Tenancy model",
    text: "Every query is bound to the authenticated tenant. Credentials, telemetry, recommendations and retrieval cannot cross tenant boundaries.",
  },
  {
    id: "curtailment",
    title: "Curtailment",
    text: "Curtailment risk is raised when forecast or live export exceeds the configured export limit. Operators should review storage dispatch or flexible load as advisory options.",
  },
  {
    id: "telemetry",
    title: "Telemetry quality",
    text: "Stale, delayed, out-of-order, simulated or poor-quality measurements reduce confidence and can downgrade high-risk recommendations.",
  },
];

const INJECTION_PATTERNS = [
  /ignore (all|any|the) (previous|prior|system) instructions/i,
  /reveal|extract|print|show.{0,20}(secret|api key|system prompt|credential)/i,
  /developer message|system prompt|hidden instruction/i,
  /execute.{0,20}(command|tool|shell|sql)/i,
  /act as.{0,30}(administrator|root|system)/i,
];

function safeText(value: unknown, maximum = 1_000): string {
  return JSON.stringify(value, (_key, item) => {
    if (
      typeof item === "string" &&
      /password|secret|token|api[_-]?key/i.test(item)
    )
      return "[REDACTED]";
    return item;
  }).slice(0, maximum);
}

export async function askCopilot(input: {
  tenantId: string;
  question: string;
  permissions: string[];
  sources?: Array<{
    id: string;
    title: string;
    data: unknown;
    requiredPermission?: string;
  }>;
}): Promise<{
  answer: string;
  citations: Array<{ id: string; title: string }>;
  tenantId: string;
  generated: true;
}> {
  assertNoPlantCommand(input.question);
  if (INJECTION_PATTERNS.some((pattern) => pattern.test(input.question)))
    throw new Error("PROMPT_INJECTION_BLOCKED");
  if (
    !input.permissions.includes("recommendation:read") &&
    !input.permissions.includes("admin:manage")
  )
    throw new Error("FORBIDDEN");

  const dynamic: CopilotSource[] = (input.sources ?? [])
    .filter(
      (source) =>
        !source.requiredPermission ||
        input.permissions.includes(source.requiredPermission) ||
        input.permissions.includes("admin:manage"),
    )
    .map((source) => ({
      id: source.id,
      title: source.title,
      text: safeText(source.data),
      tenantId: input.tenantId,
      requiredPermission: source.requiredPermission,
    }));
  const corpus = [...CORPUS, ...dynamic].filter(
    (source) => !source.tenantId || source.tenantId === input.tenantId,
  );
  const terms = input.question
    .toLowerCase()
    .split(/\W+/)
    .filter((item) => item.length > 3);
  const ranked = corpus
    .map((doc) => ({
      doc,
      score: terms.reduce(
        (sum, term) =>
          sum +
          (doc.text.toLowerCase().includes(term) ||
          doc.title.toLowerCase().includes(term)
            ? 1
            : 0),
        0,
      ),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  const selected = ranked.slice(0, 5).map((item) => item.doc);
  const evidence =
    selected.length === 0
      ? "I do not have enough permission-filtered, tenant-bound evidence to answer."
      : selected.map((doc) => `${doc.title}: ${doc.text}`).join(" ");
  return {
    tenantId: input.tenantId,
    answer: `Generated inference: ${evidence} Verify this conclusion against the cited source records. This assistant cannot issue plant commands.`,
    citations: selected.map((doc) => ({ id: doc.id, title: doc.title })),
    generated: true,
  };
}
