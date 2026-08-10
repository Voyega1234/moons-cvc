export const hookResearchReferenceTypes = [
  "product_truth",
  "evidence_backed_behavior",
  "category_signal",
  "provable_moment",
  "cultural_fever",
  "platform_buzz",
  "consumer_language"
] as const;

export const hookResearchProofTypes = [
  "official_product_page",
  "official_date",
  "campaign_date",
  "seasonality",
  "survey",
  "report",
  "government_data",
  "platform_ranking",
  "google_trends",
  "news",
  "ecommerce_data",
  "industry_report",
  "entertainment_ranking",
  "social_signal"
] as const;

export interface HookResearchReference {
  id: string;
  name: string;
  type: (typeof hookResearchReferenceTypes)[number];
  dateOrPeriod: string;
  finding: string;
  thaiAudienceRelevance: string;
  brandRelevance: string;
  sourceTitle: string;
  sourcePublisher: string;
  sourceDate: string;
  sourceUrl: string;
  proofType: (typeof hookResearchProofTypes)[number];
  proofSummary: string;
  brandSafety: "low_risk" | "medium_risk" | "high_risk";
  evidenceStrength: "strong" | "medium" | "weak";
  confidenceScore: number;
}

export interface HookResearchInsightCard {
  id: string;
  evidenceIds: string[];
  evidence: string;
  tension: string;
  beliefChallenged: string;
  humanConsequence: string;
  brandConnection: string;
  freshnessReason: string;
  confidenceScore: number;
}

export interface HookResearchDossier {
  brand: string;
  productFocus: string;
  overallFinding: string;
  references: HookResearchReference[];
  insightCards: HookResearchInsightCard[];
  strongestInsightIds: string[];
  strongestReferenceIds: string[];
  researchGaps: string[];
  researchLimitations: string;
  excluded: { name: string; reason: string }[];
  searchQueriesUsed: string[];
}

const stringArraySchema = {
  type: "array",
  items: { type: "string" }
} as const;

export const hookResearchSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    brand: { type: "string" },
    productFocus: { type: "string" },
    overallFinding: { type: "string" },
    references: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: { type: "string", enum: hookResearchReferenceTypes },
          dateOrPeriod: { type: "string" },
          finding: { type: "string" },
          thaiAudienceRelevance: { type: "string" },
          brandRelevance: { type: "string" },
          sourceTitle: { type: "string" },
          sourcePublisher: { type: "string" },
          sourceDate: { type: "string" },
          sourceUrl: { type: "string" },
          proofType: { type: "string", enum: hookResearchProofTypes },
          proofSummary: { type: "string" },
          brandSafety: {
            type: "string",
            enum: ["low_risk", "medium_risk", "high_risk"]
          },
          evidenceStrength: {
            type: "string",
            enum: ["strong", "medium", "weak"]
          },
          confidenceScore: { type: "number" }
        },
        required: [
          "id",
          "name",
          "type",
          "dateOrPeriod",
          "finding",
          "thaiAudienceRelevance",
          "brandRelevance",
          "sourceTitle",
          "sourcePublisher",
          "sourceDate",
          "sourceUrl",
          "proofType",
          "proofSummary",
          "brandSafety",
          "evidenceStrength",
          "confidenceScore"
        ]
      }
    },
    insightCards: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          evidenceIds: { ...stringArraySchema, minItems: 1 },
          evidence: { type: "string" },
          tension: { type: "string" },
          beliefChallenged: { type: "string" },
          humanConsequence: { type: "string" },
          brandConnection: { type: "string" },
          freshnessReason: { type: "string" },
          confidenceScore: { type: "number" }
        },
        required: [
          "id",
          "evidenceIds",
          "evidence",
          "tension",
          "beliefChallenged",
          "humanConsequence",
          "brandConnection",
          "freshnessReason",
          "confidenceScore"
        ]
      }
    },
    strongestInsightIds: stringArraySchema,
    strongestReferenceIds: stringArraySchema,
    researchGaps: stringArraySchema,
    researchLimitations: { type: "string" },
    excluded: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          reason: { type: "string" }
        },
        required: ["name", "reason"]
      }
    },
    searchQueriesUsed: stringArraySchema
  },
  required: [
    "brand",
    "productFocus",
    "overallFinding",
    "references",
    "insightCards",
    "strongestInsightIds",
    "strongestReferenceIds",
    "researchGaps",
    "researchLimitations",
    "excluded",
    "searchQueriesUsed"
  ]
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
  const parsed = JSON.parse(unwrapJsonCodeFence(text)) as unknown;
  if (
    !isRecord(parsed) ||
    !Array.isArray(parsed.references) ||
    !Array.isArray(parsed.insightCards)
  ) {
    throw new Error(
      "Hook Research Agent must return references and insightCards arrays."
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
  for (const [index, item] of parsed.insightCards.entries()) {
    if (
      !isRecord(item) ||
      !Array.isArray(item.evidenceIds) ||
      item.evidenceIds.length === 0
    ) {
      throw new Error(
        `Hook Research Agent insightCards[${index}] must include evidenceIds.`
      );
    }
    const missingEvidenceId = item.evidenceIds.find(
      (id) => typeof id !== "string" || !referenceIds.has(id)
    );
    if (missingEvidenceId !== undefined) {
      throw new Error(
        `Hook Research Agent insightCards[${index}] references unknown evidence id: ${String(missingEvidenceId)}.`
      );
    }
  }
  return parsed as unknown as HookResearchDossier;
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
    "Research has already been completed. Start creative reasoning from the insightCards, especially their tension, beliefChallenged, and humanConsequence fields.",
    "Use references as proof for each card's evidence. Do not turn an unsupported inference into a factual claim, and do not force every card or reference into a Direction.",
    "Any external fact or claim taken from this dossier must copy its sourceUrl into citations. Do not cite a URL that does not directly support the wording used.",
    JSON.stringify(dossier, null, 2)
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
