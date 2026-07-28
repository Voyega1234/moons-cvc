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
}

export interface ImagePromptAgentTrace {
  createdAt: string;
  provider: ImagePromptProvider;
  endpoint: "/v1/responses" | "/api/v1/responses";
  model: string;
  mode: ArtworkMode;
  stage?: "production-brief";
  status: "succeeded" | "failed";
  inputText: string;
  responsePrompt?: string;
  error?: string;
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
  const inputText =
    mode === "design-system" || mode === "design-system-new"
      ? renderCreativeGraphicDesignerPrompt(
          await loadCreativeGraphicDesignerPrompt(),
          input
        )
      : mode === "reference-library"
      ? renderReferenceLibraryPrompt(
          await loadReferenceLibraryPrompt(),
          input
        )
      : renderStandardPrompt(await loadAgentImagePrompt(), input);

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
        `${providerLabel} image prompt agent failed: ${response.status}${detail ? ` — ${detail}` : ""}`
      );
    }

    const payload = await readJsonResponse(
      response,
      `${providerLabel} image prompt agent`
    );
    const text = extractResponseText(payload);
    const parsed = JSON.parse(text) as {
      prompt?: unknown;
      finalPrompt?: unknown;
    };
    const prompt = parsed.finalPrompt ?? parsed.prompt;

    if (typeof prompt !== "string" || !prompt.trim()) {
      throw new Error(
        `${providerLabel} image prompt agent returned an empty prompt.`
      );
    }

    const responsePrompt = prompt.trim();
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

async function defaultLoadReferenceLibraryPrompt(): Promise<string> {
  return readFile(
    join(process.cwd(), "agent_prompt", "agent_artwork_reference.md"),
    "utf8"
  );
}

async function defaultLoadCreativeGraphicDesignerPrompt(): Promise<string> {
  return readFile(
    join(process.cwd(), "agent_prompt", "agent_creative_graphic_designer.md"),
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

function renderCreativeGraphicDesignerPrompt(
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
      name: input.brand?.name ?? "Unknown",
      category: input.brand?.category ?? "Unknown",
      personality: input.brand?.personality ?? [],
      colors: input.brand?.colors ?? []
    },
    campaign: {
      workingBrief: compactAgentText(input.brief || "Not provided.", 1_200),
      headline: compactAgentText(input.hook.hook, 500),
      concept: compactAgentText(input.hook.concept, 700),
      objective: compactAgentText(input.hook.why || input.brief, 700),
      cta: compactAgentText(input.hook.cta, 300),
      service: compactServiceName(input.service),
      ratio: input.canvasRatio,
      audienceMoment: input.strategy?.audienceMoment ?? null
    },
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
    JSON.stringify(runtimeInput, null, 2)
  ].join("\n");
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

function renderStandardPrompt(
  source: string,
  input: ImagePromptAgentInput
): string {
  const compactInput = {
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
    objective: input.hook.why || input.brief,
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
    references: input.referenceImages.map((image, index) =>
      buildCompactReference(image.label, index)
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

  return [
    source.trim(),
    "",
    "WORKING BRIEF PRIORITY",
    "The runtime workingBrief is the highest-priority creative instruction. Follow its explicit requirements for visual cleanliness, text density, element count, composition, mood, and exclusions even when references, defaults, or optional completion rules suggest otherwise. Preserve only immutable approved copy and official asset fidelity when resolving a conflict.",
    "",
    "AUTHORITATIVE COMPACT CAMPAIGN INPUT",
    JSON.stringify(compactInput, null, 2)
  ].join("\n");
}

function albumSequenceInput(input: ImagePromptAgentInput) {
  const format = input.albumFormat ?? defaultAlbumFormat;
  const beats = input.hook.formatBeats ?? [];
  const common = {
    format,
    delivery:
      "separate standalone image files; never a combined master, grid, collage, mosaic, or contact sheet"
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
      visualDirection: input.hook.visual,
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

const standardImagePromptSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    finalPrompt: { type: "string" }
  },
  required: ["finalPrompt"]
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
