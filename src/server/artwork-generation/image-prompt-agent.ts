import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArtworkMode } from "../../domain/creative-run.js";
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
    products: readonly { title: string; description: string }[];
    docs: readonly { title: string; description: string }[];
    refs: readonly { title: string; description: string }[];
  };
}

export interface ImagePromptAgentTrace {
  createdAt: string;
  provider: ImagePromptProvider;
  endpoint: "/v1/responses" | "/api/v1/responses";
  model: string;
  mode: ArtworkMode;
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
  loadDesignSystemPrompt = defaultLoadDesignSystemPrompt,
  loadReferenceLibraryPrompt = defaultLoadReferenceLibraryPrompt
}: {
  apiKey: string;
  model?: string;
  provider?: ImagePromptProvider;
  mode?: ArtworkMode;
  fetchImpl: FetchLike;
  input: ImagePromptAgentInput;
  writeTrace?: ImagePromptAgentTraceWriter;
  loadAgentImagePrompt?: () => Promise<string>;
  loadDesignSystemPrompt?: () => Promise<string>;
  loadReferenceLibraryPrompt?: () => Promise<string>;
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
    mode === "design-system"
      ? renderDesignSystemPrompt(await loadDesignSystemPrompt(), input)
      : mode === "reference-library"
        ? renderReferenceLibraryPrompt(
            await loadReferenceLibraryPrompt(),
            input
          )
        : renderStandardPrompt(await loadAgentImagePrompt(), input);
  const responseSchema =
    mode === "design-system" ? imagePromptSchema : standardImagePromptSchema;

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
            schema: responseSchema
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
    const prompt =
      mode === "design-system"
        ? parsed.prompt ?? parsed.finalPrompt
        : parsed.finalPrompt ?? parsed.prompt;

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

async function defaultLoadDesignSystemPrompt(): Promise<string> {
  return readFile(
    join(
      process.cwd(),
      "graphic-ad-design-system",
      "03_MASTER_CREATIVE_DIRECTOR_AGENT.md"
    ),
    "utf8"
  );
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

function renderStandardPrompt(
  source: string,
  input: ImagePromptAgentInput
): string {
  const compactInput = {
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
      ratio: input.canvasRatio,
      copyDensity: "low",
      compositionDensity: "medium-low",
      visualFreedom: 65
    },
    ...(input.textInputs.length
      ? { revisionInstructions: input.textInputs }
      : {})
  };

  return [
    source.trim(),
    "",
    "AUTHORITATIVE COMPACT CAMPAIGN INPUT",
    JSON.stringify(compactInput, null, 2)
  ].join("\n");
}

function buildCompactReference(label: string, index: number) {
  const normalized = label.trim().toLowerCase();
  const id =
    normalized
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-|-$/g, "") || `reference-${index + 1}`;

  if (/logo|โลโก้/.test(normalized)) {
    return { id, role: "logo", fidelity: "exact" };
  }
  if (/main object|hero\/source object|hero object/.test(normalized)) {
    return { id, role: "source-object", fidelity: "exact" };
  }
  if (/product|packshot|สินค้า/.test(normalized)) {
    return { id, role: "product", fidelity: "exact" };
  }
  if (/supporting component/.test(normalized)) {
    return { id, role: "supporting-component", fidelity: "exact" };
  }
  if (/client material|client context/.test(normalized)) {
    return { id, role: "client-context", fidelity: "inspired" };
  }
  if (/brand|guideline|ci|style|แบรนด์|คู่มือ|ซีไอ/.test(normalized)) {
    return { id, role: "brand-system", fidelity: "inspired" };
  }
  if (/layout|เลย์เอาต์|จัดวาง/.test(normalized)) {
    return { id, role: "layout", fidelity: "inspired" };
  }
  return { id, role: "reference", fidelity: "inspired" };
}

function compactServiceName(service: string): string {
  if (service === "single-static") return "static";
  return service;
}

function renderDesignSystemPrompt(
  source: string,
  input: ImagePromptAgentInput
): string {
  return [
    extractPromptBody(source),
    "",
    "RUNTIME EXECUTION CONTRACT — DESIGN-SYSTEM MODE",
    "Use the complete creative-direction workflow above internally. The selected hook and strategic concept below are already approved; keep them fixed while considering three genuinely distinct visual executions, then select the strongest execution.",
    "The references are authoritative for the campaign's visual medium and design grammar. A new execution means a new idea and composition inside that medium—not replacing photographic/editorial montage with isometric 3D, toy-like miniatures, generic UI cards, or clean SaaS illustration. Match the references' typography dominance, photographic-versus-illustrative balance, image scale, crop energy, density, texture, grain, and compositing character before applying brand colors.",
    "Neo does not have a downstream typography or logo compositor in this workflow. The final image prompt must request one fully composed, publication-ready advertisement containing the exact approved headline and CTA. Never request a textless base visual, blank headline zone, empty CTA zone, empty logo zone, or later deterministic assembly.",
    "Do not return the internal diagnosis, reference analysis, routes, scores, blueprint, or QA notes. Return only one final English GPT Image 2 generation prompt in the required JSON schema field.",
    buildRuntimeInputBlock(input)
  ].join("\n");
}

function renderReferenceLibraryPrompt(
  source: string,
  input: ImagePromptAgentInput
): string {
  return [
    source.trim(),
    "",
    "RUNTIME EXECUTION CONTRACT — REFERENCE-LIBRARY MODE",
    "Study the attached images directly. Primary artwork contributes abstract composition grammar; secondary artwork adds only compatible craft and finish. Invent all message-bearing visual content and the background from the approved idea. Client assets remain exact. The final image model will not receive the Moons artwork references, so make finalPrompt fully self-contained and never refer to their image numbers or ask the image model to copy an attached artwork. Apply design principles and an originality/coherence check silently, then leave room for tasteful local decisions.",
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
    brand: {
      name: input.brand?.name ?? "Unknown",
      category: input.brand?.category ?? "Unknown",
      personality: input.brand?.personality ?? [],
      colors: input.brand?.colors ?? []
    },
    output: { service: compactServiceName(input.service), ratio: input.canvasRatio },
    brief: input.brief || "Not provided.",
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
  if (normalized.includes("moons artwork reference — primary")) {
    return "primary artwork — composition and visual medium";
  }
  if (normalized.includes("moons artwork reference — secondary")) {
    return "secondary artwork — compatible craft and finish";
  }
  if (/logo|โลโก้/.test(normalized)) return "official logo — exact";
  if (/product|packshot|สินค้า/.test(normalized)) {
    return "official product — exact";
  }
  return "client reference — use only for its supplied asset role";
}

function extractPromptBody(source: string): string {
  const match = source.match(/```text\s*([\s\S]*?)\s*```/);
  return match?.[1]?.trim() || source.trim();
}

function buildRuntimeInputBlock(input: ImagePromptAgentInput): string {
  const brandInformation = [
    ...input.brandLibrary.brand.map(
      (item) => `${item.title}: ${item.description}`
    ),
    ...input.brandLibrary.products.map(
      (item) => `${item.title}: ${item.description}`
    ),
    ...input.brandLibrary.docs.map(
      (item) => `${item.title}: ${item.description}`
    )
  ];
  const referenceMap = input.referenceImages.length
    ? input.referenceImages.map(
        (image, index) =>
          `Image ${index + 1} — ${image.label || input.referenceImageLabels[index] || "Reference image"}`
      )
    : ["No reference images are attached."];

  return [
    "",
    "AUTHORITATIVE RUN INPUT",
    `Brand: ${input.brand?.name ?? "Unknown"}`,
    `Category: ${input.brand?.category ?? "Unknown"}`,
    `Service: ${input.service}`,
    `Canvas ratio: ${input.canvasRatio}`,
    "",
    "Campaign brief:",
    input.brief || "Not provided.",
    "",
    "Approved hook and concept:",
    `Required headline: ${input.hook.hook}`,
    `Strategic concept: ${input.hook.concept}`,
    `Why it works: ${input.hook.why}`,
    `Approved visual direction: ${input.hook.visual}`,
    `Supporting detail: ${input.hook.supportingPoints?.[0] ?? "None"}`,
    `Format-specific sequence: ${input.hook.formatBeats?.length ? input.hook.formatBeats.join(" → ") : "None"}`,
    `CTA: ${input.hook.cta}`,
    `Caption context: ${input.hook.caption}`,
    "",
    "Creative strategy enrichment from GPT Luna:",
    input.strategy
      ? JSON.stringify(input.strategy, null, 2)
      : "No enrichment was requested for this mode.",
    "",
    "Additional user instructions:",
    input.textInputs.length ? input.textInputs.join("\n") : "None.",
    "",
    "Brand and product library:",
    brandInformation.length ? brandInformation.join("\n") : "Not provided.",
    "",
    "Brand reference notes:",
    input.brandLibrary.refs.length
      ? input.brandLibrary.refs
          .map((item) => `${item.title}: ${item.description}`)
          .join("\n")
      : "Not provided.",
    "",
    "Attached reference map:",
    ...referenceMap,
    "Use each image only for the role implied by its label. Do not average all references into one vague style.",
    "",
    "Non-negotiable constraints:",
    "Use supplied Thai copy exactly. Use only verified details or GPT Luna creative-placeholder copy explicitly marked for text review. Do not invent additional logos, real identities, trademarks, certifications, guarantees, or unreadable text.",
    "Reference images guide design language and asset fidelity; they do not override the approved hook or strategic concept."
  ].join("\n");
}

const imagePromptSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    prompt: { type: "string" }
  },
  required: ["prompt"]
} as const;

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
