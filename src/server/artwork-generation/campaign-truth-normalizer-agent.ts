import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ImagePromptAgentHook,
  ImagePromptProvider
} from "./image-prompt-agent.js";
import type { CreativeStrategyEnrichment } from "./creative-strategy-enrichment-agent.js";

type FetchLike = typeof fetch;

export const campaignObjectives = [
  "Awareness",
  "Consideration",
  "Conversion",
  "Promotion",
  "Education",
  "Retention",
  "OMIT"
] as const;

export const campaignExecutionModes = [
  "editorial-key-visual",
  "product-led-performance",
  "retail-promotion",
  "lifestyle-commercial",
  "corporate-information",
  "marketplace-sale",
  "product-lineup",
  "textured-poster"
] as const;

export const campaignInformationDensities = [
  "low",
  "medium",
  "high"
] as const;

export const campaignHumanPresencePolicies = [
  "avoid",
  "not-required",
  "supporting",
  "essential"
] as const;

export interface CampaignPacketOfficialAsset {
  assetId: string;
  assetType: string;
  role: string;
  preservationInstruction: string;
}

export interface AuthoritativeCampaignPacket {
  campaign: {
    brand: string;
    productOrService: string;
    campaignObjective: (typeof campaignObjectives)[number];
    platform: string;
    canvas: string;
    targetAudience: string;
    audienceMoment: string;
    mainMessage: string;
  };
  copy: {
    headline: string;
    highlightedPhrase: string;
    featureName: string;
    featureValueProposition: string;
    supportingConversionLine: string;
    cta: string;
    requiredUtilityInformation: readonly string[];
  };
  creative: {
    executionMode: (typeof campaignExecutionModes)[number];
    informationDensity: (typeof campaignInformationDensities)[number];
    humanPresence: (typeof campaignHumanPresencePolicies)[number];
  };
  brandVisual: {
    brandVisualCharacter: readonly string[];
    brandPalette: readonly string[];
    referenceIntent: string;
  };
  truthAndGuardrails: {
    verifiedFacts: readonly string[];
    restrictions: readonly string[];
    latestUserCorrection: string;
  };
  officialAssets: readonly CampaignPacketOfficialAsset[];
}

export interface CampaignTruthNormalizerInput {
  brand: {
    name: string;
    category: string;
    personality: readonly string[];
    colors: readonly string[];
  } | null;
  service: string;
  platform: string;
  canvas: string;
  brief: string;
  hook: ImagePromptAgentHook;
  latestUserCorrection: string | null;
  strategy?: CreativeStrategyEnrichment;
  selectedProducts: readonly {
    title: string;
    description: string;
  }[];
  brandGuidelines: readonly {
    title: string;
    description: string;
  }[];
  brandRestrictions: readonly string[];
  officialAssetInventory: readonly CampaignPacketOfficialAsset[];
}

export interface CampaignTruthNormalizerTrace {
  createdAt: string;
  provider: ImagePromptProvider;
  endpoint: "/v1/responses" | "/api/v1/responses";
  model: string;
  status: "succeeded" | "failed";
  inputText: string;
  response?: AuthoritativeCampaignPacket;
  error?: string;
}

export type CampaignTruthNormalizerTraceWriter = (
  trace: CampaignTruthNormalizerTrace
) => Promise<void>;

const DEFAULT_MODEL = "gpt-5.6-luna";
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const OPENROUTER_RESPONSES_ENDPOINT =
  "https://openrouter.ai/api/v1/responses";

export async function normalizeCampaignTruth({
  apiKey,
  model,
  provider = "openai",
  fetchImpl,
  input,
  writeTrace,
  loadPrompt = defaultLoadPrompt
}: {
  apiKey: string;
  model?: string;
  provider?: ImagePromptProvider;
  fetchImpl: FetchLike;
  input: CampaignTruthNormalizerInput;
  writeTrace?: CampaignTruthNormalizerTraceWriter;
  loadPrompt?: () => Promise<string>;
}): Promise<AuthoritativeCampaignPacket> {
  const resolvedModel = model?.trim() || DEFAULT_MODEL;
  const endpoint =
    provider === "openrouter"
      ? OPENROUTER_RESPONSES_ENDPOINT
      : OPENAI_RESPONSES_ENDPOINT;
  const endpointPath =
    provider === "openrouter" ? "/api/v1/responses" : "/v1/responses";
  const providerLabel = provider === "openrouter" ? "OpenRouter" : "OpenAI";
  const evidence = buildEvidence(input);
  const inputText = [
    (await loadPrompt()).trim(),
    "",
    "AUTHORITATIVE RAW CAMPAIGN INPUT",
    JSON.stringify(
      {
        source: {
          brand: input.brand ?? {
            name: "OMIT",
            category: "OMIT",
            personality: [],
            colors: []
          },
          platform: input.platform,
          canvas: input.canvas,
          service: input.service,
          workingBrief: input.brief || "OMIT",
          approvedHeadline: input.hook.hook,
          approvedMainMessage: input.hook.concept || input.brief || "OMIT",
          approvedCta: input.hook.cta || "OMIT",
          requiredUtilityInformation: [
            input.hook.contactLine,
            input.hook.ctaDestination
          ].filter((value): value is string => Boolean(value?.trim())),
          strategy: input.strategy
            ? {
                commercialStyle: input.strategy.commercialStyle,
                sellingMechanism: input.strategy.sellingMechanism,
                audienceMoment: input.strategy.audienceMoment,
                humanPresence: input.strategy.humanPresence,
                proof: input.strategy.proof.map((claim) => claim.text),
                differentiator: input.strategy.differentiator.text,
                offer: input.strategy.offer.text
              }
            : null,
          selectedProducts: input.selectedProducts,
          brandGuidelines: input.brandGuidelines,
          brandRestrictions: input.brandRestrictions,
          latestUserCorrection: input.latestUserCorrection ?? "OMIT",
          officialAssetInventory: input.officialAssetInventory
        },
        evidence
      },
      null,
      2
    )
  ].join("\n");

  try {
    let requestText = inputText;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetchImpl(endpoint, {
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
              name: "moons_authoritative_campaign_packet",
              strict: true,
              schema: campaignPacketSchema
            }
          }
        })
      });

      if (!response.ok) {
        const detail = await readProviderErrorDetail(response);
        throw new Error(
          `${providerLabel} campaign truth normalizer failed: ${response.status}${detail ? ` — ${detail}` : ""}`
        );
      }

      const payload = await readJsonResponse(
        response,
        `${providerLabel} campaign truth normalizer`
      );
      const responseText = extractResponseText(payload);
      try {
        const packet = parseAndValidatePacket(
          JSON.parse(responseText) as unknown,
          input,
          evidence
        );
        await writeTraceSafely(writeTrace, {
          createdAt: new Date().toISOString(),
          provider,
          endpoint: endpointPath,
          model: resolvedModel,
          status: "succeeded",
          inputText,
          response: packet
        });
        return packet;
      } catch (error) {
        if (attempt === 0) {
          requestText = [
            inputText,
            "",
            "VALIDATION RETRY",
            `The previous packet was rejected: ${readableError(error)}`,
            "Return a corrected packet using only the authoritative source and exact evidence."
          ].join("\n");
          continue;
        }
        throw error;
      }
    }
    throw new Error("Campaign truth normalizer retry was exhausted.");
  } catch (error) {
    await writeTraceSafely(writeTrace, {
      createdAt: new Date().toISOString(),
      provider,
      endpoint: endpointPath,
      model: resolvedModel,
      status: "failed",
      inputText,
      error: readableError(error)
    });
    throw error;
  }
}

interface CampaignEvidence {
  id: string;
  value: string;
}

function buildEvidence(
  input: CampaignTruthNormalizerInput
): CampaignEvidence[] {
  const candidates: CampaignEvidence[] = [
    { id: "brief", value: input.brief },
    { id: "main-message", value: input.hook.concept },
    { id: "brand-category", value: input.brand?.category ?? "" },
    ...((input.hook.supportingPoints ?? []).map((value, index) => ({
      id: `supporting-point:${index}`,
      value
    }))),
    ...input.selectedProducts.flatMap((item, index) => [
      { id: `product:${index}:title`, value: item.title },
      { id: `product:${index}:description`, value: item.description }
    ]),
    ...input.brandGuidelines.map((item, index) => ({
      id: `guideline:${index}`,
      value: `${item.title}: ${item.description}`
    })),
    ...(input.strategy
      ? [
          ...input.strategy.proof.map((claim, index) => ({
            id: `strategy:proof:${index}`,
            value: claim.text
          })),
          {
            id: "strategy:differentiator",
            value: input.strategy.differentiator.text
          },
          { id: "strategy:offer", value: input.strategy.offer.text }
        ]
      : [])
  ];
  return candidates
    .map((item) => ({ ...item, value: item.value.trim() }))
    .filter((item) => item.value);
}

function parseAndValidatePacket(
  value: unknown,
  input: CampaignTruthNormalizerInput,
  evidence: readonly CampaignEvidence[]
): AuthoritativeCampaignPacket {
  if (!isRecord(value)) throw new Error("Campaign packet must be an object.");
  const campaign = readRecord(value.campaign, "campaign");
  const copy = readRecord(value.copy, "copy");
  const creative = readRecord(value.creative, "creative");
  const brandVisual = readRecord(value.brandVisual, "brandVisual");
  const truth = readRecord(value.truthAndGuardrails, "truthAndGuardrails");

  const packet: AuthoritativeCampaignPacket = {
    campaign: {
      brand: readString(campaign.brand, "campaign.brand"),
      productOrService: readString(
        campaign.productOrService,
        "campaign.productOrService"
      ),
      campaignObjective: readEnum(
        campaign.campaignObjective,
        campaignObjectives,
        "campaign.campaignObjective"
      ),
      platform: readString(campaign.platform, "campaign.platform"),
      canvas: readString(campaign.canvas, "campaign.canvas"),
      targetAudience: readString(
        campaign.targetAudience,
        "campaign.targetAudience"
      ),
      audienceMoment: readString(
        campaign.audienceMoment,
        "campaign.audienceMoment"
      ),
      mainMessage: readString(campaign.mainMessage, "campaign.mainMessage")
    },
    copy: {
      headline: readString(copy.headline, "copy.headline"),
      highlightedPhrase: readString(
        copy.highlightedPhrase,
        "copy.highlightedPhrase"
      ),
      featureName: readString(copy.featureName, "copy.featureName"),
      featureValueProposition: readString(
        copy.featureValueProposition,
        "copy.featureValueProposition"
      ),
      supportingConversionLine: readString(
        copy.supportingConversionLine,
        "copy.supportingConversionLine"
      ),
      cta: readString(copy.cta, "copy.cta"),
      requiredUtilityInformation: readStringArray(
        copy.requiredUtilityInformation,
        "copy.requiredUtilityInformation"
      )
    },
    creative: {
      executionMode: readEnum(
        creative.executionMode,
        campaignExecutionModes,
        "creative.executionMode"
      ),
      informationDensity: readEnum(
        creative.informationDensity,
        campaignInformationDensities,
        "creative.informationDensity"
      ),
      humanPresence: readEnum(
        creative.humanPresence,
        campaignHumanPresencePolicies,
        "creative.humanPresence"
      )
    },
    brandVisual: {
      brandVisualCharacter: readStringArray(
        brandVisual.brandVisualCharacter,
        "brandVisual.brandVisualCharacter"
      ),
      brandPalette: readStringArray(
        brandVisual.brandPalette,
        "brandVisual.brandPalette"
      ),
      referenceIntent: readString(
        brandVisual.referenceIntent,
        "brandVisual.referenceIntent"
      )
    },
    truthAndGuardrails: {
      verifiedFacts: readStringArray(
        truth.verifiedFacts,
        "truthAndGuardrails.verifiedFacts"
      ),
      restrictions: readStringArray(
        truth.restrictions,
        "truthAndGuardrails.restrictions"
      ),
      latestUserCorrection: readString(
        truth.latestUserCorrection,
        "truthAndGuardrails.latestUserCorrection"
      )
    },
    officialAssets: readOfficialAssets(value.officialAssets)
  };

  const exactBrand = input.brand?.name.trim() || "OMIT";
  const exactHeadline = input.hook.hook.trim();
  const exactCta = input.hook.cta.trim() || "OMIT";
  const exactMainMessage = input.hook.concept.trim() || input.brief.trim() || "OMIT";
  const exactCorrection = input.latestUserCorrection?.trim() || "OMIT";
  if (packet.campaign.brand !== exactBrand) {
    throw new Error("campaign.brand changed the supplied brand.");
  }
  if (packet.campaign.platform !== input.platform) {
    throw new Error("campaign.platform changed the supplied platform.");
  }
  if (packet.campaign.canvas !== input.canvas) {
    throw new Error("campaign.canvas changed the supplied canvas.");
  }
  if (packet.campaign.mainMessage !== exactMainMessage) {
    throw new Error("campaign.mainMessage changed the approved main message.");
  }
  if (packet.copy.headline !== exactHeadline) {
    throw new Error("copy.headline changed the approved headline.");
  }
  if (packet.copy.cta !== exactCta) {
    throw new Error("copy.cta changed the approved CTA.");
  }
  if (packet.truthAndGuardrails.latestUserCorrection !== exactCorrection) {
    throw new Error("latestUserCorrection changed the latest correction.");
  }
  if (
    packet.copy.highlightedPhrase !== "OMIT" &&
    !exactHeadline.includes(packet.copy.highlightedPhrase)
  ) {
    throw new Error(
      "highlightedPhrase is not an exact contiguous headline excerpt."
    );
  }
  if (
    (packet.copy.featureName === "OMIT") !==
    (packet.copy.featureValueProposition === "OMIT")
  ) {
    throw new Error("Feature name and value proposition must be omitted together.");
  }

  for (const [field, text] of [
    ["productOrService", packet.campaign.productOrService],
    ["featureName", packet.copy.featureName],
    ["featureValueProposition", packet.copy.featureValueProposition],
    ["supportingConversionLine", packet.copy.supportingConversionLine],
    ...packet.truthAndGuardrails.verifiedFacts.map(
      (fact) => ["verifiedFacts", fact] as const
    )
  ] as const) {
    if (text !== "OMIT" && !isEvidenceExcerpt(text, evidence)) {
      throw new Error(`${field} is not a verbatim excerpt of supplied evidence.`);
    }
  }

  const assetIds = new Set(
    input.officialAssetInventory.map((asset) => asset.assetId)
  );
  for (const asset of packet.officialAssets) {
    if (!assetIds.has(asset.assetId)) {
      throw new Error(`officialAssets cites unavailable asset "${asset.assetId}".`);
    }
  }

  return packet;
}

function isEvidenceExcerpt(
  text: string,
  evidence: readonly CampaignEvidence[]
): boolean {
  const normalized = normalize(text);
  return evidence.some((item) => normalize(item.value).includes(normalized));
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replaceAll(/\s+/g, " ").trim();
}

function readOfficialAssets(value: unknown): CampaignPacketOfficialAsset[] {
  if (!Array.isArray(value)) throw new Error("officialAssets must be an array.");
  return value.map((item, index) => {
    const asset = readRecord(item, `officialAssets[${index}]`);
    return {
      assetId: readString(asset.assetId, `officialAssets[${index}].assetId`),
      assetType: readString(
        asset.assetType,
        `officialAssets[${index}].assetType`
      ),
      role: readString(asset.role, `officialAssets[${index}].role`),
      preservationInstruction: readString(
        asset.preservationInstruction,
        `officialAssets[${index}].preservationInstruction`
      )
    };
  });
}

function readRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${field} must be an object.`);
  return value;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
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
  if (!allowed.includes(text)) throw new Error(`${field} is not supported.`);
  return text as T[number];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function defaultLoadPrompt(): Promise<string> {
  return readFile(
    join(
      process.cwd(),
      "agent_prompt",
      "agent_campaign_truth_normalizer.md"
    ),
    "utf8"
  );
}

async function readJsonResponse(
  response: Response,
  label: string
): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

async function readProviderErrorDetail(response: Response): Promise<string> {
  const text = await response.text();
  if (!text.trim()) return "";
  try {
    const payload = JSON.parse(text) as unknown;
    if (isRecord(payload)) {
      if (typeof payload.message === "string") return payload.message;
      if (typeof payload.error === "string") return payload.error;
      if (
        isRecord(payload.error) &&
        typeof payload.error.message === "string"
      ) {
        return payload.error.message;
      }
    }
  } catch {
    // Use the provider's plain-text response.
  }
  return text.trim().slice(0, 500);
}

function extractResponseText(payload: unknown): string {
  if (!isRecord(payload)) throw new Error("Normalizer response was malformed.");
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }
  if (!Array.isArray(payload.output)) {
    throw new Error("Normalizer response did not include output text.");
  }
  for (const item of payload.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isRecord(content) && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  throw new Error("Normalizer response did not include output text.");
}

async function writeTraceSafely(
  writer: CampaignTruthNormalizerTraceWriter | undefined,
  trace: CampaignTruthNormalizerTrace
): Promise<void> {
  if (!writer) return;
  try {
    await writer(trace);
  } catch (error) {
    console.warn("Could not write campaign truth normalizer trace.", error);
  }
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown normalizer error.";
}

const stringSchema = { type: "string" } as const;
const stringArraySchema = {
  type: "array",
  items: stringSchema
} as const;

const campaignPacketSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    campaign: {
      type: "object",
      additionalProperties: false,
      properties: {
        brand: stringSchema,
        productOrService: stringSchema,
        campaignObjective: {
          type: "string",
          enum: campaignObjectives
        },
        platform: stringSchema,
        canvas: stringSchema,
        targetAudience: stringSchema,
        audienceMoment: stringSchema,
        mainMessage: stringSchema
      },
      required: [
        "brand",
        "productOrService",
        "campaignObjective",
        "platform",
        "canvas",
        "targetAudience",
        "audienceMoment",
        "mainMessage"
      ]
    },
    copy: {
      type: "object",
      additionalProperties: false,
      properties: {
        headline: stringSchema,
        highlightedPhrase: stringSchema,
        featureName: stringSchema,
        featureValueProposition: stringSchema,
        supportingConversionLine: stringSchema,
        cta: stringSchema,
        requiredUtilityInformation: stringArraySchema
      },
      required: [
        "headline",
        "highlightedPhrase",
        "featureName",
        "featureValueProposition",
        "supportingConversionLine",
        "cta",
        "requiredUtilityInformation"
      ]
    },
    creative: {
      type: "object",
      additionalProperties: false,
      properties: {
        executionMode: {
          type: "string",
          enum: campaignExecutionModes
        },
        informationDensity: {
          type: "string",
          enum: campaignInformationDensities
        },
        humanPresence: {
          type: "string",
          enum: campaignHumanPresencePolicies
        }
      },
      required: ["executionMode", "informationDensity", "humanPresence"]
    },
    brandVisual: {
      type: "object",
      additionalProperties: false,
      properties: {
        brandVisualCharacter: stringArraySchema,
        brandPalette: stringArraySchema,
        referenceIntent: stringSchema
      },
      required: [
        "brandVisualCharacter",
        "brandPalette",
        "referenceIntent"
      ]
    },
    truthAndGuardrails: {
      type: "object",
      additionalProperties: false,
      properties: {
        verifiedFacts: stringArraySchema,
        restrictions: stringArraySchema,
        latestUserCorrection: stringSchema
      },
      required: [
        "verifiedFacts",
        "restrictions",
        "latestUserCorrection"
      ]
    },
    officialAssets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          assetId: stringSchema,
          assetType: stringSchema,
          role: stringSchema,
          preservationInstruction: stringSchema
        },
        required: [
          "assetId",
          "assetType",
          "role",
          "preservationInstruction"
        ]
      }
    }
  },
  required: [
    "campaign",
    "copy",
    "creative",
    "brandVisual",
    "truthAndGuardrails",
    "officialAssets"
  ]
} as const;
