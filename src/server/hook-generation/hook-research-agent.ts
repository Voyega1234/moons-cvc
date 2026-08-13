export interface HookResearchReference {
  id: string;
  title: string;
  content: string;
  publishedAt: string;
  sourceUrl: string;
}

export interface HookResearchInsight {
  title: string;
  content: string;
  referenceIds: string[];
}

export interface HookResearchDossier {
  summary: string;
  references: HookResearchReference[];
  insights: HookResearchInsight[];
  gaps: string[];
}

const stringArraySchema = {
  type: "array",
  items: { type: "string" }
} as const;

export const hookResearchSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    references: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          content: { type: "string" },
          publishedAt: { type: "string" },
          sourceUrl: { type: "string" }
        },
        required: ["id", "title", "content", "publishedAt", "sourceUrl"]
      }
    },
    insights: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          content: { type: "string" },
          referenceIds: { ...stringArraySchema, minItems: 1 }
        },
        required: ["title", "content", "referenceIds"]
      }
    },
    gaps: stringArraySchema
  },
  required: ["summary", "references", "insights", "gaps"]
} as const;

export function buildHookResearchPrompt(
  policyPrompt: string,
  runtimeInput: string
): string {
  return [
    policyPrompt.trim(),
    "",
    "# Runtime input",
    runtimeInput,
    "",
    `Current date: ${new Date().toISOString()}`,
    "Timezone: Asia/Bangkok"
  ].join("\n");
}

export function parseHookResearchDossier(text: string): HookResearchDossier {
  const raw = JSON.parse(unwrapJsonCodeFence(text)) as unknown;
  const parsed = normalizeLegacyDossier(raw);
  if (
    !isRecord(parsed) ||
    typeof parsed.summary !== "string" ||
    !Array.isArray(parsed.references) ||
    !Array.isArray(parsed.insights) ||
    !Array.isArray(parsed.gaps)
  ) {
    throw new Error(
      "Hook Research Agent must return summary, references, insights, and gaps."
    );
  }

  const referenceIds = new Set<string>();
  for (const [index, item] of parsed.references.entries()) {
    if (!isRecord(item) || !isHttpUrl(item.sourceUrl)) {
      throw new Error(
        `Hook Research Agent references[${index}].sourceUrl must be a valid HTTP URL.`
      );
    }
    if (typeof item.id === "string") referenceIds.add(item.id);
  }
  for (const [index, item] of parsed.insights.entries()) {
    if (
      !isRecord(item) ||
      !Array.isArray(item.referenceIds) ||
      item.referenceIds.length === 0
    ) {
      throw new Error(
        `Hook Research Agent insights[${index}] must include referenceIds.`
      );
    }
    const missingReferenceId = item.referenceIds.find(
      (id) => typeof id !== "string" || !referenceIds.has(id)
    );
    if (missingReferenceId !== undefined) {
      throw new Error(
        `Hook Research Agent insights[${index}] references unknown reference id: ${String(missingReferenceId)}.`
      );
    }
  }
  return parsed as unknown as HookResearchDossier;
}

function normalizeLegacyDossier(value: unknown): unknown {
  if (!isRecord(value) || Array.isArray(value.insights)) return value;
  if (!Array.isArray(value.references) || !Array.isArray(value.insightCards)) {
    return value;
  }

  return {
    summary: readString(value.overallFinding),
    references: value.references.map((reference) => {
      if (!isRecord(reference)) return reference;
      return {
        id: readString(reference.id),
        title: readString(reference.sourceTitle) || readString(reference.name),
        content:
          readString(reference.proofSummary) || readString(reference.finding),
        publishedAt:
          readString(reference.sourceDate) ||
          readString(reference.dateOrPeriod) ||
          "unknown",
        sourceUrl: readString(reference.sourceUrl)
      };
    }),
    insights: value.insightCards.map((insight) => {
      if (!isRecord(insight)) return insight;
      return {
        title: readString(insight.tension) || readString(insight.id),
        content: [
          readString(insight.evidence),
          readString(insight.beliefChallenged),
          readString(insight.humanConsequence),
          readString(insight.brandConnection),
          readString(insight.freshnessReason)
        ]
          .filter(Boolean)
          .join(" "),
        referenceIds: Array.isArray(insight.evidenceIds)
          ? insight.evidenceIds
          : []
      };
    }),
    gaps: [
      ...(Array.isArray(value.researchGaps) ? value.researchGaps : []),
      readString(value.researchLimitations)
    ].filter(Boolean)
  };
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function unwrapJsonCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced?.[1]?.trim() ?? trimmed;
}

export function hookResearchDossierBlock(
  dossier: HookResearchDossier
): string {
  return [
    "# Dedicated Research Agent dossier",
    "Research has already been completed. Start creative reasoning from insights, which are ordered strongest first and compactly combine evidence, tension, belief challenged, human consequence, why now, and brand connection.",
    "Treat references as factual guardrails. Prefer insights that begin with an external audience, seasonal, societal, cultural, platform, consumer-language, or category signal and connect the brand only after the tension is clear.",
    "When an insight contains a current update, statistic, benchmark, or research finding, use it to sharpen stakes, scale, comparison, consequence, or belief—not as a generic fact dump.",
    "Use each insight's referenceIds as proof. Do not turn an unsupported inference into a factual claim, and do not force every insight or reference into a Direction.",
    "Any external fact or claim taken from this dossier must copy the matching reference sourceUrl into citations. Do not cite a URL that does not directly support the wording used.",
    JSON.stringify(dossier)
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
