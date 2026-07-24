import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImagePromptAgentHook } from "./image-prompt-agent.js";

type FetchLike = typeof fetch;

export const commercialStyles = [
  "minimal",
  "lifestyle",
  "premium",
  "promotion",
  "infographic",
  "social-proof",
  "story",
  "playful"
] as const;

export const sellingMechanisms = [
  "offer",
  "proof",
  "demonstration",
  "comparison",
  "transformation",
  "problem-solution",
  "desire",
  "identity",
  "objection"
] as const;

export const preferredArtworkModes = [
  "luxury",
  "standard_commercial",
  "fmcg_energy",
  "tech_b2b",
  "social_youth"
] as const;

export const preferredArtworkLayouts = [
  "architectural_plane_split",
  "central_monument",
  "cinematic_problem_solution",
  "diagonal_motion",
  "editorial_premium",
  "lifestyle_commercial",
  "marketplace_promo",
  "premium_hero_negative_space",
  "product_stage_plinth",
  "ui_dashboard_glass"
] as const;

export const preferredHeroTypes = [
  "card_ui",
  "device",
  "object_metaphor",
  "person",
  "product_group",
  "product_packshot",
  "typography_led",
  "vehicle"
] as const;

export const humanPresencePolicies = [
  "avoid",
  "supporting",
  "essential"
] as const;

type CommercialStyle = (typeof commercialStyles)[number];
type SellingMechanism = (typeof sellingMechanisms)[number];
type PreferredArtworkMode = (typeof preferredArtworkModes)[number];
type PreferredArtworkLayout = (typeof preferredArtworkLayouts)[number];
type PreferredHeroType = (typeof preferredHeroTypes)[number];
type HumanPresencePolicy = (typeof humanPresencePolicies)[number];
type EvidenceUse = "offer" | "proof" | "differentiator";
type ClaimSource = "verified" | "creative-placeholder" | "none";

export interface CreativeStrategyEvidence {
  id: string;
  kind: "brief" | "supporting-point" | "brand" | "product" | "document";
  value: string;
  allowedUses: readonly EvidenceUse[];
}

interface EvidenceClaim {
  text: string;
  evidenceId: string;
  source: ClaimSource;
}

export interface CreativeStrategyEnrichment {
  commercialStyle: CommercialStyle;
  sellingMechanism: SellingMechanism;
  preferredMode: PreferredArtworkMode;
  preferredLayout: PreferredArtworkLayout;
  preferredHeroType: PreferredHeroType;
  humanPresence: HumanPresencePolicy;
  audienceMoment: string;
  reasonToBelieve: string;
  visibleProofDirection: string;
  offer: EvidenceClaim;
  proof: readonly EvidenceClaim[];
  differentiator: EvidenceClaim;
  referenceSearchText: string;
  evidenceStatus: "verified" | "mixed" | "placeholder" | "none";
  requiresTextReview: boolean;
  missingEvidence: readonly string[];
}

export interface CreativeStrategyEnrichmentInput {
  brand: {
    name: string;
    category: string;
    personality: readonly string[];
    colors: readonly string[];
  } | null;
  service: string;
  brief: string;
  hook: ImagePromptAgentHook;
  brandMemory: {
    working: readonly string[];
    avoid: readonly string[];
  };
  brandLibrary: {
    brand: readonly { title: string; description: string }[];
    products: readonly { title: string; description: string }[];
    docs: readonly { title: string; description: string }[];
    refs: readonly { title: string; description: string }[];
  };
}

export interface CreativeStrategyEnrichmentTrace {
  createdAt: string;
  model: string;
  status: "succeeded" | "failed";
  inputText: string;
  response?: CreativeStrategyEnrichment;
  error?: string;
}

export type CreativeStrategyEnrichmentTraceWriter = (
  trace: CreativeStrategyEnrichmentTrace
) => Promise<void>;

const DEFAULT_MODEL = "gpt-5.6-luna";
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";

export async function enrichCreativeStrategy({
  apiKey,
  model,
  fetchImpl,
  input,
  writeTrace,
  loadPrompt = defaultLoadPrompt
}: {
  apiKey: string;
  model?: string;
  fetchImpl: FetchLike;
  input: CreativeStrategyEnrichmentInput;
  writeTrace?: CreativeStrategyEnrichmentTraceWriter;
  loadPrompt?: () => Promise<string>;
}): Promise<CreativeStrategyEnrichment> {
  const resolvedModel = model?.trim() || DEFAULT_MODEL;
  const evidence = buildCreativeStrategyEvidence(input);
  const inputText = buildInputText(await loadPrompt(), input, evidence);

  try {
    let requestText = inputText;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetchImpl(OPENAI_RESPONSES_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: resolvedModel,
          store: false,
          input: [
            {
              role: "user",
              content: [{ type: "input_text", text: requestText }]
            }
          ],
          text: {
            format: {
              type: "json_schema",
              name: "moons_creative_strategy_enrichment",
              strict: true,
              schema: enrichmentSchema
            }
          }
        })
      });

      if (!response.ok) {
        throw new Error(
          `OpenAI creative strategy enrichment failed: ${response.status}`
        );
      }

      const payload = await readJsonResponse(response);
      const responseText = extractResponseText(payload);
      const raw = JSON.parse(responseText) as unknown;
      try {
        const strategy = parseAndValidateStrategy(raw, evidence);

        await writeTraceSafely(writeTrace, {
          createdAt: new Date().toISOString(),
          model: resolvedModel,
          status: "succeeded",
          inputText,
          response: strategy
        });
        return strategy;
      } catch (error) {
        if (attempt === 0 && isRetryableClaimConsistencyError(error)) {
          requestText = buildClaimConsistencyRetryText(
            inputText,
            responseText,
            readableError(error)
          );
          continue;
        }
        throw error;
      }
    }

    throw new Error("Creative strategy enrichment retry was exhausted.");
  } catch (error) {
    await writeTraceSafely(writeTrace, {
      createdAt: new Date().toISOString(),
      model: resolvedModel,
      status: "failed",
      inputText,
      error: readableError(error)
    });
    throw error;
  }
}

function isRetryableClaimConsistencyError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /^(offer|proof|differentiator) with source none must be empty\.$/.test(
      error.message
    )
  );
}

function buildClaimConsistencyRetryText(
  inputText: string,
  previousResponse: string,
  validationError: string
): string {
  return [
    inputText,
    "",
    "VALIDATION RETRY",
    `The previous JSON failed validation: ${validationError}`,
    "Return the complete corrected JSON object. When any claim uses source \"none\", both text and evidenceId must be empty strings. Keep all grounded valid fields unchanged.",
    "",
    "PREVIOUS INVALID JSON",
    previousResponse
  ].join("\n");
}

export function buildCreativeStrategyEvidence(
  input: CreativeStrategyEnrichmentInput
): readonly CreativeStrategyEvidence[] {
  return [
    evidenceItem("brief:0", "brief", input.brief, [
      "offer",
      "proof",
      "differentiator"
    ]),
    ...((input.hook.supportingPoints ?? []).map((value, index) =>
      evidenceItem(`supporting-point:${index}`, "supporting-point", value, [
        "offer",
        "proof",
        "differentiator"
      ])
    )),
    ...input.brandLibrary.brand.map((item, index) =>
      evidenceItem(
        `brand:${index}`,
        "brand",
        `${item.title}: ${item.description}`,
        ["proof", "differentiator"]
      )
    ),
    ...input.brandLibrary.products.map((item, index) =>
      evidenceItem(
        `product:${index}`,
        "product",
        `${item.title}: ${item.description}`,
        ["offer", "proof", "differentiator"]
      )
    ),
    ...input.brandLibrary.docs.map((item, index) =>
      evidenceItem(
        `document:${index}`,
        "document",
        `${item.title}: ${item.description}`,
        ["offer", "proof", "differentiator"]
      )
    )
  ].filter((item) => item.value.trim());
}

function evidenceItem(
  id: string,
  kind: CreativeStrategyEvidence["kind"],
  value: string,
  allowedUses: readonly EvidenceUse[]
): CreativeStrategyEvidence {
  return { id, kind, value: value.trim(), allowedUses };
}

async function defaultLoadPrompt(): Promise<string> {
  return readFile(
    join(process.cwd(), "agent_prompt", "agent_creative_strategy_enrichment.md"),
    "utf8"
  );
}

function buildInputText(
  prompt: string,
  input: CreativeStrategyEnrichmentInput,
  evidence: readonly CreativeStrategyEvidence[]
): string {
  return [
    prompt.trim(),
    "",
    "AUTHORITATIVE STRATEGY INPUT",
    JSON.stringify(
      {
        brand: input.brand ?? {
          name: "Unknown",
          category: "Unknown",
          personality: [],
          colors: []
        },
        service: input.service,
        brief: input.brief,
        approvedDirection: input.hook,
        brandMemory: input.brandMemory,
        brandReferences: input.brandLibrary.refs,
        evidence
      },
      null,
      2
    )
  ].join("\n");
}

function parseAndValidateStrategy(
  value: unknown,
  evidence: readonly CreativeStrategyEvidence[]
): CreativeStrategyEnrichment {
  if (!isRecord(value)) {
    throw new Error("Creative strategy enrichment returned invalid JSON.");
  }

  const strategy: CreativeStrategyEnrichment = {
    commercialStyle: readEnum(
      value.commercialStyle,
      commercialStyles,
      "commercialStyle"
    ),
    sellingMechanism: readEnum(
      value.sellingMechanism,
      sellingMechanisms,
      "sellingMechanism"
    ),
    preferredMode: readEnum(
      value.preferredMode,
      preferredArtworkModes,
      "preferredMode"
    ),
    preferredLayout: readEnum(
      value.preferredLayout,
      preferredArtworkLayouts,
      "preferredLayout"
    ),
    preferredHeroType: readEnum(
      value.preferredHeroType,
      preferredHeroTypes,
      "preferredHeroType"
    ),
    humanPresence: readEnum(
      value.humanPresence,
      humanPresencePolicies,
      "humanPresence"
    ),
    audienceMoment: readString(value.audienceMoment, "audienceMoment"),
    reasonToBelieve: readString(value.reasonToBelieve, "reasonToBelieve"),
    visibleProofDirection: readString(
      value.visibleProofDirection,
      "visibleProofDirection"
    ),
    offer: readEvidenceClaim(value.offer, "offer"),
    proof: readEvidenceClaims(value.proof, "proof"),
    differentiator: readEvidenceClaim(value.differentiator, "differentiator"),
    referenceSearchText: readString(
      value.referenceSearchText,
      "referenceSearchText"
    ),
    evidenceStatus: readEnum(
      value.evidenceStatus,
      ["verified", "mixed", "placeholder", "none"] as const,
      "evidenceStatus"
    ),
    requiresTextReview: readBoolean(
      value.requiresTextReview,
      "requiresTextReview"
    ),
    missingEvidence: readStringArray(value.missingEvidence, "missingEvidence")
  };

  validateEvidenceClaim(strategy.offer, "offer", evidence);
  for (const claim of strategy.proof) {
    validateEvidenceClaim(claim, "proof", evidence);
  }
  validateEvidenceClaim(strategy.differentiator, "differentiator", evidence);
  const hasPlaceholder = [
    strategy.offer,
    ...strategy.proof,
    strategy.differentiator
  ].some((claim) => claim.source === "creative-placeholder");
  if (hasPlaceholder && !strategy.requiresTextReview) {
    throw new Error(
      "Creative placeholder claims require requiresTextReview to be true."
    );
  }
  return strategy;
}

function validateEvidenceClaim(
  claim: EvidenceClaim,
  use: EvidenceUse,
  evidence: readonly CreativeStrategyEvidence[]
): void {
  if (claim.source === "none") {
    if (claim.text || claim.evidenceId) {
      throw new Error(`${use} with source none must be empty.`);
    }
    return;
  }
  if (claim.source === "creative-placeholder") {
    if (!claim.text || claim.evidenceId) {
      throw new Error(
        `${use} creative-placeholder requires text and an empty evidenceId.`
      );
    }
    return;
  }
  if (!claim.text || !claim.evidenceId) {
    throw new Error(`${use} verified claim requires text and evidenceId.`);
  }

  const source = evidence.find((item) => item.id === claim.evidenceId);
  if (!source || !source.allowedUses.includes(use)) {
    throw new Error(`${use} cites unavailable evidence "${claim.evidenceId}".`);
  }
  if (!normalizeEvidence(source.value).includes(normalizeEvidence(claim.text))) {
    throw new Error(`${use} text is not a verbatim excerpt of its evidence.`);
  }
}

function normalizeEvidence(value: string): string {
  return value.normalize("NFKC").toLowerCase().replaceAll(/\s+/g, " ").trim();
}

function readEvidenceClaims(value: unknown, field: string): EvidenceClaim[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  return value.map((item, index) =>
    readEvidenceClaim(item, `${field}[${index}]`)
  );
}

function readEvidenceClaim(value: unknown, field: string): EvidenceClaim {
  if (!isRecord(value)) throw new Error(`${field} must be an object.`);
  return {
    text: readString(value.text, `${field}.text`),
    evidenceId: readString(value.evidenceId, `${field}.evidenceId`),
    source: readEnum(
      value.source,
      ["verified", "creative-placeholder", "none"] as const,
      `${field}.source`
    )
  };
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean.`);
  return value;
}

function readStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  return value.map((item, index) => readString(item, `${field}[${index}]`));
}

function readEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string
): T[number] {
  const text = readString(value, field);
  if (!allowed.includes(text)) {
    throw new Error(`${field} is not supported.`);
  }
  return text as T[number];
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string.`);
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) throw new Error("Creative strategy enrichment returned empty JSON.");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Creative strategy enrichment returned non-JSON data.");
  }
}

function extractResponseText(payload: unknown): string {
  if (!isRecord(payload)) {
    throw new Error("Creative strategy enrichment returned an invalid response.");
  }
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }
  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      if (!isRecord(item) || !Array.isArray(item.content)) continue;
      for (const content of item.content) {
        if (isRecord(content) && typeof content.text === "string") {
          return content.text;
        }
      }
    }
  }
  throw new Error("Creative strategy enrichment returned no output text.");
}

async function writeTraceSafely(
  writeTrace: CreativeStrategyEnrichmentTraceWriter | undefined,
  trace: CreativeStrategyEnrichmentTrace
): Promise<void> {
  if (!writeTrace) return;
  try {
    await writeTrace(trace);
  } catch (error) {
    console.warn("Could not write creative strategy enrichment trace.", error);
  }
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown strategy error.";
}

const evidenceClaimSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    text: { type: "string" },
    evidenceId: { type: "string" },
    source: {
      type: "string",
      enum: ["verified", "creative-placeholder", "none"]
    }
  },
  required: ["text", "evidenceId", "source"]
} as const;

const enrichmentSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    commercialStyle: { type: "string", enum: commercialStyles },
    sellingMechanism: { type: "string", enum: sellingMechanisms },
    preferredMode: { type: "string", enum: preferredArtworkModes },
    preferredLayout: { type: "string", enum: preferredArtworkLayouts },
    preferredHeroType: { type: "string", enum: preferredHeroTypes },
    humanPresence: { type: "string", enum: humanPresencePolicies },
    audienceMoment: { type: "string" },
    reasonToBelieve: { type: "string" },
    visibleProofDirection: { type: "string" },
    offer: evidenceClaimSchema,
    proof: { type: "array", items: evidenceClaimSchema },
    differentiator: evidenceClaimSchema,
    referenceSearchText: { type: "string" },
    evidenceStatus: {
      type: "string",
      enum: ["verified", "mixed", "placeholder", "none"]
    },
    requiresTextReview: { type: "boolean" },
    missingEvidence: { type: "array", items: { type: "string" } }
  },
  required: [
    "commercialStyle",
    "sellingMechanism",
    "preferredMode",
    "preferredLayout",
    "preferredHeroType",
    "humanPresence",
    "audienceMoment",
    "reasonToBelieve",
    "visibleProofDirection",
    "offer",
    "proof",
    "differentiator",
    "referenceSearchText",
    "evidenceStatus",
    "requiresTextReview",
    "missingEvidence"
  ]
} as const;
