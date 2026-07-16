import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArtworkMode } from "../../domain/creative-run.js";

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
  brandLibrary: {
    brand: readonly { title: string; description: string }[];
    products: readonly { title: string; description: string }[];
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
    "Inspect the attached image labeled as a Moons artwork reference. It is the selected result from the complete 72-artwork verified catalog. Transfer its design reasoning only; create a new execution for the approved campaign angle.",
    "Attached client references and labeled source assets override the internal library for brand identity, product fidelity, and visual-medium consistency.",
    "Study the reference typography as a conditional style recipe: font genre, width, weight, scale ratios, line-break rhythm, alignment, containers, emphasis, dimensionality, outline, and shadow. Use those traits only when they fit the runtime brand identity and approved mood. If they conflict, keep the brand-appropriate typeface and borrow only compatible hierarchy and rhythm; state the chosen typography treatment explicitly in the final prompt.",
    "Before writing finalPrompt, silently complete the 12-principle design blueprint: hierarchy, balance, contrast, alignment, proximity, repetition, emphasis, white space, scale and proportion, rhythm and movement, unity and consistency, and grid and composition. Commit to one dominant focal point, one reading order, one balance strategy, shared alignment lines, grouped information, controlled repetition, protected white space, explicit scale relationships, one eye path, one visual language, and measurable margins/zones. Translate these into concrete generation instructions; never merely name the principles.",
    "Reject any proposed composition in which the headline, hero, offer, and CTA all compete equally, unrelated information floats without alignment or proximity, or the reference style overrides message clarity and brand fit.",
    "The selected hook and strategic concept are approved. Do not replace them with a library example's message, objects, brand, or scene.",
    "Return only one final English GPT Image 2 prompt in the required finalPrompt JSON field.",
    buildRuntimeInputBlock(input)
  ].join("\n");
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
    "Additional user instructions:",
    input.textInputs.length ? input.textInputs.join("\n") : "None.",
    "",
    "Brand and product library:",
    brandInformation.length ? brandInformation.join("\n") : "Not provided.",
    "",
    "Attached reference map:",
    ...referenceMap,
    "Use each image only for the role implied by its label. Do not average all references into one vague style.",
    "",
    "Non-negotiable constraints:",
    "Use supplied Thai copy exactly. Do not invent claims, prices, logos, certifications, or unreadable text.",
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
