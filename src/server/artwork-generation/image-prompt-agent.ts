import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  defaultAlbumFormat,
  type AlbumFormat,
  type ArtworkMode
} from "../../domain/creative-run.js";
import type { CreativeStrategyEnrichment } from "./creative-strategy-enrichment-agent.js";

type FetchLike = typeof fetch;

export type ImagePromptProvider = "openai" | "openrouter";

export interface ImagePromptAgentHook {
  hook: string;
  concept: string;
  why: string;
  visual: string;
  cta: string;
  supportingPoints?: readonly string[];
  formatBeats?: readonly string[];
  ctaActionType?: string;
  ctaDestination?: string;
  contactLine?: string;
  caption: string;
}

export interface ImagePromptAgentInput {
  brand: {
    name: string;
    category: string;
    personality: readonly string[];
    colors: readonly string[];
  } | null;
  service: string;
  albumFormat?: AlbumFormat;
  brief: string;
  hook: ImagePromptAgentHook;
  textInputs: readonly string[];
  referenceImageLabels: readonly string[];
  referenceImages: readonly {
    imageUrl: string;
    label: string;
  }[];
  canvasRatio: string;
  strategy?: CreativeStrategyEnrichment;
  brandLibrary: {
    brand: readonly { title: string; description: string }[];
    products: readonly { id?: string; title: string; description: string }[];
    docs: readonly { title: string; description: string }[];
    refs: readonly { title: string; description: string }[];
  };
  selectedProductIds?: readonly string[];
  setDirection?: string;
  shotOpportunity?: string;
}

export interface ImagePromptAgentTrace {
  createdAt: string;
  provider: ImagePromptProvider;
  endpoint: "/v1/responses" | "/api/v1/responses";
  model: string;
  mode: ArtworkMode;
  stage?: "campaign-input-preflight" | "production-brief";
  status: "succeeded" | "failed";
  inputText: string;
  responsePrompt?: string;
  error?: string;
}

export interface CampaignInputPreflight {
  brand: {
    name: string;
    category: string;
    colors: readonly string[];
  };
  primaryProductOrService: string;
  objective: string;
  targetAudience: string;
  singleMainMessage: string;
  concept: string;
  copy: {
    headline: string;
    supportingText: readonly string[];
    cta: string;
  };
  requiredElements: readonly string[];
  forbiddenElements: readonly string[];
  references: readonly {
    image: number;
    id: string;
    role: string;
    use: string;
    ignore: string;
  }[];
  lockedProductFacts: readonly string[];
  excludedInformation: readonly string[];
  albumSequence: readonly string[];
  userInstructions: readonly string[];
  output: {
    service: string;
    ratio: string;
  };
}

export type ImagePromptAgentTraceWriter = (
  trace: ImagePromptAgentTrace
) => Promise<void>;

const DEFAULT_MODEL = "gpt-5.6-terra";
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const OPENROUTER_RESPONSES_ENDPOINT =
  "https://openrouter.ai/api/v1/responses";

export async function generateImagePrompt({
  apiKey,
  model,
  provider = "openai",
  mode = "standard",
  fetchImpl,
  input,
  writeTrace,
  loadAgentImagePrompt = defaultLoadAgentImagePrompt,
  loadReferenceLibraryPrompt = defaultLoadReferenceLibraryPrompt,
  loadCreativeGraphicDesignerPrompt = defaultLoadCreativeGraphicDesignerPrompt
}: {
  apiKey: string;
  model?: string;
  provider?: ImagePromptProvider;
  mode?: ArtworkMode;
  fetchImpl: FetchLike;
  input: ImagePromptAgentInput;
  writeTrace?: ImagePromptAgentTraceWriter;
  loadAgentImagePrompt?: () => Promise<string>;
  loadReferenceLibraryPrompt?: () => Promise<string>;
  loadCreativeGraphicDesignerPrompt?: () => Promise<string>;
}): Promise<string> {
  const resolvedModel = model?.trim() || DEFAULT_MODEL;
  const endpoint =
    provider === "openrouter"
      ? OPENROUTER_RESPONSES_ENDPOINT
      : OPENAI_RESPONSES_ENDPOINT;
  const endpointPath =
    provider === "openrouter" ? "/api/v1/responses" : "/v1/responses";
  const providerLabel = provider === "openrouter" ? "OpenRouter" : "OpenAI";
  const isDesignSystemMode =
    mode === "design-system" || mode === "design-system-new";
  const inputText = isDesignSystemMode
    ? renderLegacyV6CreativeConceptPrompt(
        await loadCreativeGraphicDesignerPrompt(),
        input
      )
    : mode === "reference-library"
      ? renderReferenceLibraryPrompt(
          await loadReferenceLibraryPrompt(),
          input
        )
      : await buildStandardImagePrompt(input, loadAgentImagePrompt);

  try {
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
            content: [
              { type: "input_text", text: inputText },
              ...input.referenceImages.map((image) => ({
                type: "input_image" as const,
                image_url: image.imageUrl,
                detail: "high" as const
              }))
            ]
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: isDesignSystemMode
              ? "moons_creative_visual_concept"
              : "moons_image_generation_prompt",
            strict: true,
            schema: isDesignSystemMode
              ? creativeConceptSchema
              : standardImagePromptSchema
          }
        }
      })
    });

    if (!response.ok) {
      const detail = await readProviderErrorDetail(response);
      throw new Error(
        `${providerLabel} image prompt agent failed: ${response.status}${detail ? ` — ${detail}` : ""}`
      );
    }

    const payload = await readJsonResponse(
      response,
      `${providerLabel} image prompt agent`
    );
    const text = extractResponseText(payload);
    const parsed = JSON.parse(text) as unknown;
    const responsePrompt = isDesignSystemMode
      ? parseCreativeVisualConcept(parsed, providerLabel)
      : parseStandardImagePrompt(parsed, providerLabel);
    await writeTraceSafely(writeTrace, {
      createdAt: new Date().toISOString(),
      provider,
      endpoint: endpointPath,
      model: resolvedModel,
      mode,
      status: "succeeded",
      inputText,
      responsePrompt
    });
    return responsePrompt;
  } catch (error) {
    await writeTraceSafely(writeTrace, {
      createdAt: new Date().toISOString(),
      provider,
      endpoint: endpointPath,
      model: resolvedModel,
      mode,
      status: "failed",
      inputText,
      error: readableError(error)
    });
    throw error;
  }
}

export async function buildStandardImagePrompt(
  input: ImagePromptAgentInput,
  loadAgentImagePrompt: () => Promise<string> = defaultLoadAgentImagePrompt,
  campaignInput: unknown = buildCompactCampaignInput(input)
): Promise<string> {
  return renderStandardPrompt(await loadAgentImagePrompt(), campaignInput);
}

export async function preflightCampaignInput({
  apiKey,
  fetchImpl,
  input,
  writeTrace,
  loadPrompt = defaultLoadCampaignInputPreflightPrompt
}: {
  apiKey: string;
  fetchImpl: FetchLike;
  input: ImagePromptAgentInput;
  writeTrace?: ImagePromptAgentTraceWriter;
  loadPrompt?: () => Promise<string>;
}): Promise<CampaignInputPreflight> {
  const model = DEFAULT_MODEL;
  const inputText = [
    (await loadPrompt()).trim(),
    "",
    "CAMPAIGN INPUT TO PREFLIGHT",
    JSON.stringify(buildCompactCampaignInput(input), null, 2)
  ].join("\n");

  try {
    const response = await fetchImpl(OPENAI_RESPONSES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        store: false,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: inputText }]
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "moons_campaign_input_preflight",
            strict: true,
            schema: campaignInputPreflightSchema
          }
        }
      })
    });
    if (!response.ok) {
      const detail = await readProviderErrorDetail(response);
      throw new Error(
        `OpenAI campaign input preflight failed: ${response.status}${detail ? ` — ${detail}` : ""}`
      );
    }
    const payload = await readJsonResponse(
      response,
      "OpenAI campaign input preflight"
    );
    const parsed = JSON.parse(extractResponseText(payload)) as unknown;
    const result = parseCampaignInputPreflight(parsed);
    await writeTraceSafely(writeTrace, {
      createdAt: new Date().toISOString(),
      provider: "openai",
      endpoint: "/v1/responses",
      model,
      mode: "standard",
      stage: "campaign-input-preflight",
      status: "succeeded",
      inputText,
      responsePrompt: JSON.stringify(result, null, 2)
    });
    return result;
  } catch (error) {
    await writeTraceSafely(writeTrace, {
      createdAt: new Date().toISOString(),
      provider: "openai",
      endpoint: "/v1/responses",
      model,
      mode: "standard",
      stage: "campaign-input-preflight",
      status: "failed",
      inputText,
      error: readableError(error)
    });
    throw error;
  }
}

export async function generateProductionBrief({
  apiKey,
  model,
  provider = "openai",
  fetchImpl,
  compiledDesignSystemPrompt,
  referenceImages,
  writeTrace,
  loadProductionBriefPrompt = defaultLoadProductionBriefPrompt
}: {
  apiKey: string;
  model?: string;
  provider?: ImagePromptProvider;
  fetchImpl: FetchLike;
  compiledDesignSystemPrompt: string;
  referenceImages: ImagePromptAgentInput["referenceImages"];
  writeTrace?: ImagePromptAgentTraceWriter;
  loadProductionBriefPrompt?: () => Promise<string>;
}): Promise<string> {
  const resolvedModel = model?.trim() || DEFAULT_MODEL;
  const endpoint =
    provider === "openrouter"
      ? OPENROUTER_RESPONSES_ENDPOINT
      : OPENAI_RESPONSES_ENDPOINT;
  const endpointPath =
    provider === "openrouter" ? "/api/v1/responses" : "/v1/responses";
  const providerLabel = provider === "openrouter" ? "OpenRouter" : "OpenAI";
  const inputText = renderProductionBriefPrompt(
    await loadProductionBriefPrompt(),
    compiledDesignSystemPrompt
  );

  try {
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
            content: [
              { type: "input_text", text: inputText },
              ...referenceImages.map((image) => ({
                type: "input_image" as const,
                image_url: image.imageUrl,
                detail: "high" as const
              }))
            ]
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "moons_image_generation_prompt",
            strict: true,
            schema: standardImagePromptSchema
          }
        }
      })
    });

    if (!response.ok) {
      const detail = await readProviderErrorDetail(response);
      throw new Error(
        `${providerLabel} production brief agent failed: ${response.status}${detail ? ` — ${detail}` : ""}`
      );
    }

    const payload = await readJsonResponse(
      response,
      `${providerLabel} production brief agent`
    );
    const text = extractResponseText(payload);
    const parsed = JSON.parse(text) as { finalPrompt?: unknown };
    if (typeof parsed.finalPrompt !== "string" || !parsed.finalPrompt.trim()) {
      throw new Error(
        `${providerLabel} production brief agent returned an empty prompt.`
      );
    }

    const responsePrompt = parsed.finalPrompt.trim();
    validateProductionBrief(responsePrompt);
    await writeTraceSafely(writeTrace, {
      createdAt: new Date().toISOString(),
      provider,
      endpoint: endpointPath,
      model: resolvedModel,
      mode: "design-system-new",
      stage: "production-brief",
      status: "succeeded",
      inputText,
      responsePrompt
    });
    return responsePrompt;
  } catch (error) {
    await writeTraceSafely(writeTrace, {
      createdAt: new Date().toISOString(),
      provider,
      endpoint: endpointPath,
      model: resolvedModel,
      mode: "design-system-new",
      stage: "production-brief",
      status: "failed",
      inputText,
      error: readableError(error)
    });
    throw error;
  }
}

async function writeTraceSafely(
  writeTrace: ImagePromptAgentTraceWriter | undefined,
  trace: ImagePromptAgentTrace
): Promise<void> {
  if (!writeTrace) return;

  try {
    await writeTrace(trace);
  } catch (error) {
    console.warn("Could not write image prompt agent debug trace.", error);
  }
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown image prompt agent error.";
}

async function defaultLoadAgentImagePrompt(): Promise<string> {
  return readFile(join(process.cwd(), "agent_prompt", "agent_image.md"), "utf8");
}

async function defaultLoadCampaignInputPreflightPrompt(): Promise<string> {
  return readFile(
    join(process.cwd(), "agent_prompt", "agent_campaign_input_preflight.md"),
    "utf8"
  );
}

async function defaultLoadReferenceLibraryPrompt(): Promise<string> {
  return readFile(
    join(process.cwd(), "agent_prompt", "agent_artwork_reference.md"),
    "utf8"
  );
}

async function defaultLoadCreativeGraphicDesignerPrompt(): Promise<string> {
  return readFile(
    join(
      process.cwd(),
      "agent_prompt",
      "versions",
      "2026-07-28-chol-static-03-v6",
      "prompts",
      "02-creative-concept-director.exact.md"
    ),
    "utf8"
  );
}

async function defaultLoadProductionBriefPrompt(): Promise<string> {
  return readFile(
    join(process.cwd(), "agent_prompt", "agent_production_brief.md"),
    "utf8"
  );
}

const productionBriefSections = [
  "CENTRAL IDEA",
  "VISUAL EVENT",
  "COMPOSITION",
  "SUBJECT AND ENVIRONMENT",
  "CAMERA",
  "LIGHT AND MATERIAL",
  "TYPOGRAPHY",
  "OFFICIAL ASSETS",
  "IMMUTABLE FACTS",
  "DO NOT INVENT",
  "OUTPUT"
] as const;

function renderProductionBriefPrompt(
  source: string,
  compiledDesignSystemPrompt: string
): string {
  const marker = "{{COMPILED_DESIGN_SYSTEM_PROMPT}}";
  if (!source.includes(marker)) {
    throw new Error(
      `agent_production_brief.md is missing required marker: ${marker}`
    );
  }
  return source.trim().replaceAll(marker, compiledDesignSystemPrompt.trim());
}

function validateProductionBrief(prompt: string): void {
  const missingSections = productionBriefSections.filter(
    (section) => !prompt.includes(section)
  );
  if (missingSections.length) {
    throw new Error(
      `Production brief is missing required sections: ${missingSections.join(", ")}`
    );
  }
  const sectionPositions = productionBriefSections.map((section) =>
    prompt.indexOf(section)
  );
  if (
    sectionPositions.some(
      (position, index) => index > 0 && position <= sectionPositions[index - 1]!
    )
  ) {
    throw new Error("Production brief sections are not in the required order.");
  }
}

function renderLegacyV6CreativeConceptPrompt(
  source: string,
  input: ImagePromptAgentInput
): string {
  const explicitGuidelines = [
    ...input.brandLibrary.docs.filter(isExplicitBrandGuideline),
    ...input.brandLibrary.brand.filter(isExplicitBrandGuideline)
  ]
    .slice(0, 3)
    .map((item) => ({
      title: compactAgentText(item.title, 120),
      description: compactAgentText(item.description, 1_200)
    }));
  const selectedProductIds = new Set(input.selectedProductIds ?? []);
  const selectedProducts = input.brandLibrary.products.filter(
    (item) => !selectedProductIds.size || (item.id && selectedProductIds.has(item.id))
  );
  const runtimeInput = {
    brand: {
      name: input.brand?.name ?? "OMIT",
      category: input.brand?.category ?? "OMIT",
      personality: input.brand?.personality ?? [],
      colors: input.brand?.colors ?? []
    },
    campaign: {
      workingBrief: compactAgentText(input.brief || "Not provided.", 1_200),
      headline: compactAgentText(input.hook.hook, 500),
      concept: compactAgentText(input.hook.concept, 700),
      objective: compactAgentText(input.hook.why || input.brief, 700),
      cta: compactAgentText(input.hook.cta, 300),
      supportingPoints: (input.hook.supportingPoints ?? [])
        .map((item) => compactAgentText(item, 400))
        .filter(Boolean),
      requiredUtilityInformation: {
        contactLine: compactAgentText(input.hook.contactLine ?? "", 300) || null,
        actionType: compactAgentText(input.hook.ctaActionType ?? "", 120) || null,
        destination:
          compactAgentText(input.hook.ctaDestination ?? "", 300) || null
      },
      service: compactServiceName(input.service),
      ratio: input.canvasRatio,
      audienceMoment: input.strategy?.audienceMoment ?? null
    },
    campaignSetDirection: input.setDirection ?? null,
    shotOpportunity: input.shotOpportunity ?? null,
    strategySelectedEvidence: input.strategy
      ? {
          proof: input.strategy.proof.map((claim) => claim.text),
          differentiator:
            input.strategy.differentiator.source === "none"
              ? null
              : input.strategy.differentiator.text,
          offer:
            input.strategy.offer.source === "none"
              ? null
              : input.strategy.offer.text
        }
      : null,
    explicitBrandGuidelines: explicitGuidelines,
    productOrServiceEvidence: selectedProducts.slice(0, 4).map((item) => ({
      title: compactAgentText(item.title, 160),
      description: compactAgentText(item.description, 500)
    })),
    references: input.referenceImages.map((image, index) =>
      buildCompactReference(image.label, index)
    ),
    latestCorrection:
      input.textInputs.map((item) => item.trim()).filter(Boolean).at(-1) ?? null
  };

  return [
    source.trim(),
    "",
    "AUTHORITATIVE RUNTIME INPUT",
    JSON.stringify(runtimeInput, null, 2),
    "",
    "RUNTIME OUTPUT ENVELOPE",
    'Return strict JSON matching {"visualConcept":"..."}.',
    "The visualConcept value must follow the prompt's original three-sentence paragraph requirement. This JSON envelope changes transport only, not the creative task."
  ].join("\n");
}

function parseStandardImagePrompt(
  parsed: unknown,
  providerLabel: string
): string {
  if (!isRecord(parsed)) {
    throw new Error(
      `${providerLabel} image prompt agent returned invalid JSON.`
    );
  }
  const prompt = parsed.finalPrompt ?? parsed.prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new Error(
      `${providerLabel} image prompt agent returned an empty prompt.`
    );
  }
  return prompt.trim();
}

function parseCampaignInputPreflight(
  parsed: unknown
): CampaignInputPreflight {
  if (!isRecord(parsed)) {
    throw new Error("OpenAI campaign input preflight returned invalid JSON.");
  }
  return parsed as unknown as CampaignInputPreflight;
}

function parseCreativeVisualConcept(
  parsed: unknown,
  providerLabel: string
): string {
  if (!isRecord(parsed)) {
    throw new Error(
      `${providerLabel} creative concept director returned invalid JSON.`
    );
  }
  if (
    typeof parsed.visualConcept !== "string" ||
    !parsed.visualConcept.trim()
  ) {
    throw new Error(
      `${providerLabel} creative concept director returned an empty visual concept.`
    );
  }
  return parsed.visualConcept.trim();
}

function isExplicitBrandGuideline(item: {
  title: string;
}): boolean {
  return /guideline|brand\s*(?:ci|identity|system)|visual\s*(?:identity|system)|style\s*guide|คู่มือ|อัตลักษณ์|ซีไอ/i.test(
    item.title
  );
}

function compactAgentText(value: string, maxCharacters: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxCharacters) return clean;
  return `${clean.slice(0, Math.max(0, maxCharacters - 1)).trimEnd()}…`;
}

function renderStandardPrompt(source: string, campaignInput: unknown): string {
  return [
    source.trim(),
    "",
    "AUTHORITATIVE PREFLIGHTED CAMPAIGN INPUT",
    JSON.stringify(campaignInput, null, 2)
  ].join("\n");
}

export function buildCompactCampaignInput(input: ImagePromptAgentInput) {
  const classifiedReferences = input.referenceImages.map((image, index) =>
    buildCompactReference(image.label, index)
  );
  const explicitlyPrimaryStyleIndex = classifiedReferences.findIndex(
    (reference) => reference.role === "primary-style"
  );
  const primaryStyleIndex =
    explicitlyPrimaryStyleIndex >= 0
      ? explicitlyPrimaryStyleIndex
      : classifiedReferences.findIndex((reference) =>
          isStandardStyleReferenceRole(reference.role)
        );
  return {
    brand: {
      name: input.brand?.name ?? "Unknown",
      category: input.brand?.category ?? "Unknown",
      colors: input.brand?.colors ?? []
    },
    objective: input.hook.why || input.hook.concept,
    angle: {
      headline: input.hook.hook,
      concept: input.hook.concept,
      ...(input.hook.supportingPoints?.length
        ? { supportingDetails: input.hook.supportingPoints }
        : {}),
      ...(input.hook.formatBeats?.length
        ? { formatBeats: input.hook.formatBeats }
        : {}),
      cta: input.hook.cta
    },
    ...(classifiedReferences.length
      ? {
          referencePolicy: {
            mapping:
              "Image numbers below match the attached image[] order exactly.",
            visualPriority:
              "Treat the primary reference as the strongest source of visual direction, but not as a blanket lock on every visual attribute. Identify its most distinctive transferable visual ideas and select the ones that best serve this campaign concept, such as its interaction pattern, composition rhythm, camera perspective, lighting, palette, atmosphere, typography, or graphic treatment. Preserve and adapt high-salience visual mechanisms when they support the idea; do not mechanically copy the whole image and do not reduce the reference to palette or mood alone.",
            productIsolation:
              "Product materials control only the visible identity of the product itself. Preserve the product exactly, but never inherit camera angle, crop, composition, placement, lighting setup, background, surface, props, or scene from a product material."
          }
        }
      : {}),
    references: classifiedReferences.map((reference, index) =>
      buildStandardReference(
        reference,
        index,
        index === primaryStyleIndex
      )
    ),
    output: {
      service: compactServiceName(input.service),
      ratio: input.canvasRatio
    },
    ...(input.service === "album-post"
      ? {
          albumSequence: albumSequenceInput(input)
        }
      : {}),
    ...(input.textInputs.length
      ? { revisionInstructions: input.textInputs }
      : {})
  };
}

function isStandardStyleReferenceRole(role: string): boolean {
  return [
    "primary-style",
    "style",
    "brand-visual-dna",
    "brand-system",
    "layout",
    "primary-reference",
    "reference"
  ].includes(role);
}

function buildStandardReference(
  reference: ReturnType<typeof buildCompactReference>,
  index: number,
  primaryStyle: boolean
) {
  const base = {
    image: index + 1,
    id: reference.id
  };

  if (primaryStyle) {
    return {
      ...base,
      role: "primary-style-and-composition-reference",
      use:
        "Use this image as the strongest source of visual direction. Identify the distinctive visual ideas that make it recognizable, then choose and adapt the ones that best support the campaign concept. The useful signal may be its interaction pattern, composition rhythm, camera perspective, lighting, palette, atmosphere, typography, or graphic treatment. Do not automatically copy every attribute, and do not reduce its influence to palette or mood alone."
    };
  }

  if (
    reference.role === "primary-product" ||
    reference.role === "product" ||
    reference.role === "source-object"
  ) {
    return {
      ...base,
      role: "product-identity-only",
      use:
        "Preserve exactly only the product itself: its shape, packaging, label, colors, proportions, materials, and visible identity.",
      ignore:
        "Do not use this image as a reference for camera angle, crop, composition, placement, scale in the canvas, lighting setup, background, surface, props, or scene."
    };
  }

  return {
    ...base,
    role: reference.role,
    use:
      "Use only the visual information implied by this role; do not let it override the primary style-and-composition reference."
  };
}

function albumSequenceInput(input: ImagePromptAgentInput) {
  const format = input.albumFormat ?? defaultAlbumFormat;
  const beats = input.hook.formatBeats ?? [];
  const common = {
    format,
    delivery:
      "one square master artboard using the requested panel layout; the backend will crop it into separate standalone image files"
  };
  if (format === "three-vertical") {
    return {
      ...common,
      imageCount: 3,
      image1: "portrait cover with hook and main visual",
      image2: [beats[0], beats[1]].filter(Boolean).join(" + ") || "square support and proof",
      image3: beats[2] ?? "square offer and CTA"
    };
  }
  if (format === "three-horizontal") {
    return {
      ...common,
      imageCount: 3,
      image1: "landscape cover with hook and main visual",
      image2: [beats[0], beats[1]].filter(Boolean).join(" + ") || "square support and proof",
      image3: beats[2] ?? "square offer and CTA"
    };
  }
  if (format === "four-vertical") {
    return {
      ...common,
      imageCount: 4,
      image1: "portrait cover with hook and main visual",
      image2: beats[0] ?? "square opening support",
      image3: beats[1] ?? "square mechanism or proof",
      image4: beats[2] ?? "square offer and CTA"
    };
  }
  return {
    ...common,
    imageCount: 4,
    image1: "square cover with hook and main visual",
    image2: beats[0] ?? "square opening support",
    image3: beats[1] ?? "square mechanism or proof",
    image4: beats[2] ?? "square offer and CTA"
  };
}

function buildCompactReference(label: string, index: number) {
  const normalized = label.trim().toLowerCase();
  const primary = normalized.includes("primary reference");
  const explicitRole = /·\s*(product|logo|style|content)\s*·/.exec(
    normalized
  )?.[1];
  const id =
    normalized
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-|-$/g, "") || `reference-${index + 1}`;

  if (/past work style reference/.test(normalized)) {
    return { id, role: "brand-visual-dna", fidelity: "style-only" };
  }
  if (explicitRole === "logo") {
    return { id, role: primary ? "primary-logo" : "logo", fidelity: "exact" };
  }
  if (explicitRole === "product") {
    return {
      id,
      role: primary ? "primary-product" : "product",
      fidelity: "exact"
    };
  }
  if (explicitRole === "style") {
    return {
      id,
      role: primary ? "primary-style" : "style",
      fidelity: "inspired"
    };
  }
  if (explicitRole === "content") {
    return {
      id,
      role: primary ? "primary-content" : "content",
      fidelity: "information-only"
    };
  }
  if (/logo|โลโก้/.test(normalized)) {
    return { id, role: primary ? "primary-logo" : "logo", fidelity: "exact" };
  }
  if (/current artwork to revise/.test(normalized)) {
    return { id, role: "revision-base", fidelity: "preserve-and-improve" };
  }
  if (/main object|hero\/source object|hero object/.test(normalized)) {
    return { id, role: "source-object", fidelity: "exact" };
  }
  if (/product|packshot|สินค้า/.test(normalized)) {
    return {
      id,
      role: primary ? "primary-product" : "product",
      fidelity: "exact"
    };
  }
  if (/supporting component/.test(normalized)) {
    return { id, role: "supporting-component", fidelity: "exact" };
  }
  if (/client material|client context/.test(normalized)) {
    return { id, role: "client-context", fidelity: "inspired" };
  }
  if (/brand|guideline|ci|style|แบรนด์|คู่มือ|ซีไอ/.test(normalized)) {
    return {
      id,
      role: primary ? "primary-style" : "brand-system",
      fidelity: "inspired"
    };
  }
  if (/layout|เลย์เอาต์|จัดวาง/.test(normalized)) {
    return { id, role: "layout", fidelity: "inspired" };
  }
  if (/content|ข้อความ/.test(normalized)) {
    return {
      id,
      role: primary ? "primary-content" : "content",
      fidelity: "information-only"
    };
  }
  return {
    id,
    role: primary ? "primary-reference" : "reference",
    fidelity: "inspired"
  };
}

function compactServiceName(service: string): string {
  if (service === "single-static") return "static";
  return service;
}

function renderReferenceLibraryPrompt(
  source: string,
  input: ImagePromptAgentInput
): string {
  return [
    source.trim(),
    "",
    "RUNTIME EXECUTION CONTRACT — REFERENCE-LIBRARY MODE",
    "Study the attached images directly. Primary artwork contributes abstract composition grammar; secondary artwork adds only compatible craft and finish. Invent all message-bearing visual content and the background from the approved idea. Client assets remain exact. The final image model will receive these same images in the same order. Make finalPrompt self-contained, identify attached images only by their assigned roles, and explicitly direct the image model to study their compatible visual technique without copying recognizable content. Apply design principles and an originality/coherence check silently, then leave room for tasteful local decisions.",
    buildReferenceLibraryRuntimeInputBlock(input)
  ].join("\n");
}

function buildReferenceLibraryRuntimeInputBlock(
  input: ImagePromptAgentInput
): string {
  const strategy = input.strategy
    ? {
        commercialStyle: input.strategy.commercialStyle,
        sellingMechanism: input.strategy.sellingMechanism,
        audienceMoment: input.strategy.audienceMoment,
        visibleProofDirection: input.strategy.visibleProofDirection,
        offer: compactStrategyClaim(input.strategy.offer),
        proof: input.strategy.proof
          .map(compactStrategyClaim)
          .filter((claim) => claim !== null),
        differentiator: compactStrategyClaim(input.strategy.differentiator),
        requiresTextReview: input.strategy.requiresTextReview
      }
    : null;
  const runtimeInput = {
    workingBrief: {
      priority: "highest",
      instruction: input.brief || "Not provided."
    },
    brand: {
      name: input.brand?.name ?? "Unknown",
      category: input.brand?.category ?? "Unknown",
      personality: input.brand?.personality ?? [],
      colors: input.brand?.colors ?? []
    },
    output: {
      service: compactServiceName(input.service),
      ratio: input.canvasRatio,
      ...(input.service === "album-post"
        ? { albumFormat: input.albumFormat ?? defaultAlbumFormat }
        : {})
    },
    approved: {
      headline: input.hook.hook,
      concept: input.hook.concept,
      ...(input.hook.supportingPoints?.length
        ? { supportingDetails: input.hook.supportingPoints }
        : {}),
      cta: input.hook.cta
    },
    strategy,
    references: input.referenceImages.map((image, index) => ({
      image: index + 1,
      role: referenceLibraryRole(image.label)
    })),
    ...(input.textInputs.length
      ? { revisionInstructions: input.textInputs }
      : {})
  };

  return [
    "AUTHORITATIVE COMPACT RUN INPUT",
    JSON.stringify(runtimeInput, null, 2)
  ].join("\n");
}

function compactStrategyClaim(
  claim: CreativeStrategyEnrichment["offer"]
): { text: string; source: string } | null {
  return claim.text ? { text: claim.text, source: claim.source } : null;
}

function referenceLibraryRole(label: string): string {
  const normalized = label.toLowerCase();
  const primary = normalized.includes("primary reference");
  const prefix = primary ? "PRIMARY — " : "";
  const explicitRole = /·\s*(product|logo|style|content)\s*·/.exec(
    normalized
  )?.[1];
  if (explicitRole === "logo") return `${prefix}official logo — exact`;
  if (explicitRole === "product") return `${prefix}official product — exact`;
  if (explicitRole === "style") {
    return `${prefix}style reference — borrow visual language only; do not copy content`;
  }
  if (explicitRole === "content") {
    return `${prefix}content reference — use for supplied facts or copy only`;
  }
  if (normalized.includes("current artwork to revise")) {
    return "current artwork revision base — preserve approved identity and improve only the diagnosed issues";
  }
  if (normalized.includes("creative compass artwork reference — primary")) {
    return "primary artwork — composition and visual medium";
  }
  if (normalized.includes("creative compass artwork reference — secondary")) {
    return "secondary artwork — compatible craft and finish";
  }
  if (normalized.includes("past work style reference")) {
    return "approved past work — infer brand visual DNA only; do not copy its content";
  }
  if (/logo|โลโก้/.test(normalized)) return `${prefix}official logo — exact`;
  if (/product|packshot|สินค้า/.test(normalized)) {
    return `${prefix}official product — exact`;
  }
  if (/style|แบรนด์/.test(normalized)) {
    return `${prefix}style reference — borrow visual language only; do not copy content`;
  }
  if (/content|ข้อความ/.test(normalized)) {
    return `${prefix}content reference — use for supplied facts or copy only`;
  }
  return `${prefix}client reference — use only for its supplied asset role`;
}

const creativeConceptSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    visualConcept: { type: "string" }
  },
  required: ["visualConcept"]
} as const;

const standardImagePromptSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    finalPrompt: { type: "string" }
  },
  required: ["finalPrompt"]
} as const;

const campaignInputPreflightSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    brand: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        category: { type: "string" },
        colors: { type: "array", items: { type: "string" } }
      },
      required: ["name", "category", "colors"]
    },
    primaryProductOrService: { type: "string" },
    objective: { type: "string" },
    targetAudience: { type: "string" },
    singleMainMessage: { type: "string" },
    concept: { type: "string" },
    copy: {
      type: "object",
      additionalProperties: false,
      properties: {
        headline: { type: "string" },
        supportingText: { type: "array", items: { type: "string" } },
        cta: { type: "string" }
      },
      required: ["headline", "supportingText", "cta"]
    },
    requiredElements: { type: "array", items: { type: "string" } },
    forbiddenElements: { type: "array", items: { type: "string" } },
    references: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          image: { type: "integer" },
          id: { type: "string" },
          role: { type: "string" },
          use: { type: "string" },
          ignore: { type: "string" }
        },
        required: ["image", "id", "role", "use", "ignore"]
      }
    },
    lockedProductFacts: { type: "array", items: { type: "string" } },
    excludedInformation: { type: "array", items: { type: "string" } },
    albumSequence: { type: "array", items: { type: "string" } },
    userInstructions: { type: "array", items: { type: "string" } },
    output: {
      type: "object",
      additionalProperties: false,
      properties: {
        service: { type: "string" },
        ratio: { type: "string" }
      },
      required: ["service", "ratio"]
    }
  },
  required: [
    "brand",
    "primaryProductOrService",
    "objective",
    "targetAudience",
    "singleMainMessage",
    "concept",
    "copy",
    "requiredElements",
    "forbiddenElements",
    "references",
    "lockedProductFacts",
    "excludedInformation",
    "albumSequence",
    "userInstructions",
    "output"
  ]
} as const;

async function readProviderErrorDetail(response: Response): Promise<string> {
  const text = await response.text();
  if (!text.trim()) return "";

  let detail = text;
  try {
    const payload = JSON.parse(text) as unknown;
    if (isRecord(payload)) {
      if (typeof payload.message === "string") {
        detail = payload.message;
      } else if (typeof payload.error === "string") {
        detail = payload.error;
      } else if (
        isRecord(payload.error) &&
        typeof payload.error.message === "string"
      ) {
        detail = payload.error.message;
      }
    }
  } catch {
    // Plain-text provider errors are already safe to summarize below.
  }

  return detail.replace(/\s+/g, " ").trim().slice(0, 300);
}

function extractResponseText(payload: unknown): string {
  if (isRecord(payload) && typeof payload.output_text === "string") {
    return payload.output_text;
  }

  if (!isRecord(payload) || !Array.isArray(payload.output)) {
    throw new Error("OpenAI image prompt agent response did not include output text.");
  }

  for (const item of payload.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (
        isRecord(content) &&
        content.type === "output_text" &&
        typeof content.text === "string"
      ) {
        return content.text;
      }
    }
  }

  throw new Error("OpenAI image prompt agent response did not include output text.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readJsonResponse(
  response: Response,
  label: string
): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(`${label} returned an empty response body.`);
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} returned a non-JSON response.`);
  }
}
