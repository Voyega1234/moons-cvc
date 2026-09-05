import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AlbumFormat } from "../../domain/creative-run.js";
import type { ImagePromptProvider } from "./image-prompt-agent.js";

type FetchLike = typeof fetch;

export interface CreativeSetIdea {
  directionId: string;
  headline: string;
  concept: string;
}

export interface CreativeSetDirection {
  setDirection: string;
  ideas: readonly {
    directionId: string;
    shotOpportunity: string;
  }[];
}

export interface VisualQualityReview {
  decision: "pass" | "revise";
  density: "controlled" | "too-dense" | "too-empty";
  aiAppearance: "credible" | "noticeable" | "obvious";
  aiLikelihoodPercent: number;
  strengths: readonly string[];
  issues: readonly string[];
  revisionInstruction: string;
}

export interface AlbumPanelSeparationReview {
  decision: "pass" | "revise";
  affectedPanels: readonly number[];
  issue: string;
  revisionInstruction: string;
}

export interface RevisionPlan {
  refinedInstruction: string;
}

export interface DesignSystemFlowTrace {
  createdAt: string;
  provider: ImagePromptProvider;
  endpoint: "/v1/responses" | "/api/v1/responses";
  model: string;
  stage:
    | "set-creative-direction"
    | "visual-qc"
    | "album-panel-qc"
    | "revision-planning";
  status: "succeeded" | "failed";
  inputText: string;
  referenceImages: readonly {
    label?: string;
    mimeType: string;
    bytes: number;
  }[];
  response?:
    | CreativeSetDirection
    | VisualQualityReview
    | AlbumPanelSeparationReview
    | RevisionPlan;
  error?: string;
}

export type DesignSystemFlowTraceWriter = (
  trace: DesignSystemFlowTrace
) => Promise<void>;

const DEFAULT_MODEL = "gpt-5.6-luna";
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const OPENROUTER_RESPONSES_ENDPOINT =
  "https://openrouter.ai/api/v1/responses";

export async function directCreativeSet({
  apiKey,
  model,
  provider = "openai",
  fetchImpl,
  lockedCampaignInput,
  ideas,
  referenceImages,
  writeTrace,
  loadPrompt = loadSetCreativeDirectorPrompt
}: {
  apiKey: string;
  model?: string;
  provider?: ImagePromptProvider;
  fetchImpl: FetchLike;
  lockedCampaignInput: unknown;
  ideas: readonly CreativeSetIdea[];
  referenceImages: readonly {
    imageUrl: string;
    label?: string;
    mimeType: string;
    bytes: number;
  }[];
  writeTrace?: DesignSystemFlowTraceWriter;
  loadPrompt?: () => Promise<string>;
}): Promise<CreativeSetDirection> {
  const inputText = [
    (await loadPrompt()).trim(),
    "",
    "LOCKED CAMPAIGN INPUT",
    JSON.stringify(lockedCampaignInput, null, 2),
    "",
    "SELECTED IDEAS",
    JSON.stringify(ideas, null, 2)
  ].join("\n");

  return callStructuredAgent({
    apiKey,
    model,
    provider,
    fetchImpl,
    stage: "set-creative-direction",
    inputText,
    referenceImages,
    schemaName: "moons_creative_set_direction",
    schema: creativeSetDirectionSchema,
    parse: (value) => parseCreativeSetDirection(value, ideas),
    writeTrace
  });
}

export async function reviewGeneratedArtwork({
  apiKey,
  model,
  provider = "openai",
  fetchImpl,
  image,
  context,
  writeTrace,
  loadPrompt = loadVisualQcPrompt
}: {
  apiKey: string;
  model?: string;
  provider?: ImagePromptProvider;
  fetchImpl: FetchLike;
  image: {
    bytes: Buffer;
    mimeType: string;
    label?: string;
  };
  context: {
    headline: string;
    concept: string;
    setDirection: string;
    shotOpportunity: string;
  };
  writeTrace?: DesignSystemFlowTraceWriter;
  loadPrompt?: () => Promise<string>;
}): Promise<VisualQualityReview> {
  const inputText = [
    (await loadPrompt()).trim(),
    "",
    "ACTIVE CREATIVE CONTEXT",
    JSON.stringify(context, null, 2)
  ].join("\n");

  return callStructuredAgent({
    apiKey,
    model,
    provider,
    fetchImpl,
    stage: "visual-qc",
    inputText,
    referenceImages: [
      {
        imageUrl: `data:${image.mimeType};base64,${image.bytes.toString("base64")}`,
        label: image.label,
        mimeType: image.mimeType,
        bytes: image.bytes.length
      }
    ],
    schemaName: "moons_visual_quality_review",
    schema: visualQualityReviewSchema,
    parse: parseVisualQualityReview,
    writeTrace
  });
}

export async function planArtworkRevision({
  apiKey,
  model,
  provider = "openai",
  fetchImpl,
  image,
  instructions,
  writeTrace
}: {
  apiKey: string;
  model?: string;
  provider?: ImagePromptProvider;
  fetchImpl: FetchLike;
  image: {
    bytes: Buffer;
    mimeType: string;
    label?: string;
  };
  instructions: string;
  writeTrace?: DesignSystemFlowTraceWriter;
}): Promise<RevisionPlan> {
  const inputText = [
    "You are looking at Image 1, the current artwork. The user wants this exact change applied:",
    instructions.trim(),
    "",
    "Look carefully at Image 1 first and identify exactly where the relevant element(s) are located",
    "(e.g. \"top red headline\", \"info panel on the right\", \"bottom-left corner\").",
    "Then rewrite the request as a precise, unambiguous instruction for an image-editing model,",
    "naming the exact location(s) and what to change at each one.",
    "Do not invent changes the user did not ask for, and do not change anything you were not asked to change."
  ].join("\n");

  return callStructuredAgent({
    apiKey,
    model,
    provider,
    fetchImpl,
    stage: "revision-planning",
    inputText,
    referenceImages: [
      {
        imageUrl: `data:${image.mimeType};base64,${image.bytes.toString("base64")}`,
        label: image.label,
        mimeType: image.mimeType,
        bytes: image.bytes.length
      }
    ],
    schemaName: "moons_revision_plan",
    schema: revisionPlanSchema,
    parse: parseRevisionPlan,
    writeTrace
  });
}

export async function reviewAlbumPanelSeparation({
  apiKey,
  model,
  fetchImpl,
  format,
  panels,
  writeTrace,
  loadPrompt = loadAlbumPanelQcPrompt
}: {
  apiKey: string;
  model?: string;
  fetchImpl: FetchLike;
  format: AlbumFormat;
  panels: readonly {
    index: number;
    bytes: Buffer;
    mimeType: string;
  }[];
  writeTrace?: DesignSystemFlowTraceWriter;
  loadPrompt?: () => Promise<string>;
}): Promise<AlbumPanelSeparationReview> {
  const inputText = [
    (await loadPrompt()).trim(),
    "",
    "ACTIVE ALBUM FORMAT",
    format,
    "",
    "ATTACHMENT ORDER",
    panels
      .map((panel) => `Image ${panel.index} = Panel ${panel.index}`)
      .join("\n")
  ].join("\n");

  return callStructuredAgent({
    apiKey,
    model,
    provider: "openai",
    fetchImpl,
    stage: "album-panel-qc",
    inputText,
    referenceImages: panels.map((panel) => ({
      imageUrl: `data:${panel.mimeType};base64,${panel.bytes.toString("base64")}`,
      label: `Panel ${panel.index}`,
      mimeType: panel.mimeType,
      bytes: panel.bytes.length
    })),
    schemaName: "moons_album_panel_separation_review",
    schema: albumPanelSeparationReviewSchema,
    parse: (value) => parseAlbumPanelSeparationReview(value, panels.length),
    writeTrace
  });
}

async function callStructuredAgent<T>({
  apiKey,
  model,
  provider,
  fetchImpl,
  stage,
  inputText,
  referenceImages,
  schemaName,
  schema,
  parse,
  writeTrace
}: {
  apiKey: string;
  model?: string;
  provider: ImagePromptProvider;
  fetchImpl: FetchLike;
  stage: DesignSystemFlowTrace["stage"];
  inputText: string;
  referenceImages: readonly {
    imageUrl: string;
    label?: string;
    mimeType: string;
    bytes: number;
  }[];
  schemaName: string;
  schema: object;
  parse: (value: unknown) => T;
  writeTrace?: DesignSystemFlowTraceWriter;
}): Promise<T> {
  const resolvedModel = model?.trim() || DEFAULT_MODEL;
  const endpoint =
    provider === "openrouter"
      ? OPENROUTER_RESPONSES_ENDPOINT
      : OPENAI_RESPONSES_ENDPOINT;
  const endpointPath =
    provider === "openrouter" ? "/api/v1/responses" : "/v1/responses";
  const providerLabel = provider === "openrouter" ? "OpenRouter" : "OpenAI";
  const traceImages = referenceImages.map(
    ({ label, mimeType, bytes }) => ({
      ...(label ? { label } : {}),
      mimeType,
      bytes
    })
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
            name: schemaName,
            strict: true,
            schema
          }
        }
      })
    });

    if (!response.ok) {
      const detail = await readProviderErrorDetail(response);
      throw new Error(
        `${providerLabel} ${stage} failed: ${response.status}${detail ? ` — ${detail}` : ""}`
      );
    }

    const payload = await readJsonResponse(response, `${providerLabel} ${stage}`);
    const parsed = parse(JSON.parse(extractResponseText(payload)) as unknown);
    await writeTraceSafely(writeTrace, {
      createdAt: new Date().toISOString(),
      provider,
      endpoint: endpointPath,
      model: resolvedModel,
      stage,
      status: "succeeded",
      inputText,
      referenceImages: traceImages,
      response: parsed as
        | CreativeSetDirection
        | VisualQualityReview
        | AlbumPanelSeparationReview
    });
    return parsed;
  } catch (error) {
    await writeTraceSafely(writeTrace, {
      createdAt: new Date().toISOString(),
      provider,
      endpoint: endpointPath,
      model: resolvedModel,
      stage,
      status: "failed",
      inputText,
      referenceImages: traceImages,
      error: readableError(error)
    });
    throw error;
  }
}

function parseCreativeSetDirection(
  value: unknown,
  ideas: readonly CreativeSetIdea[]
): CreativeSetDirection {
  if (!isRecord(value)) {
    throw new Error("Set Creative Director returned invalid JSON.");
  }
  const setDirection = readNonEmptyString(value.setDirection, "setDirection");
  if (!Array.isArray(value.ideas)) {
    throw new Error("Set Creative Director returned invalid ideas.");
  }
  const parsedIdeas = value.ideas.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Set Creative Director idea ${index + 1} is invalid.`);
    }
    return {
      directionId: readNonEmptyString(
        item.directionId,
        `ideas[${index}].directionId`
      ),
      shotOpportunity: readNonEmptyString(
        item.shotOpportunity,
        `ideas[${index}].shotOpportunity`
      )
    };
  });
  const expectedIds = ideas.map((idea) => idea.directionId).sort();
  const receivedIds = parsedIdeas.map((idea) => idea.directionId).sort();
  if (
    expectedIds.length !== receivedIds.length ||
    expectedIds.some((id, index) => id !== receivedIds[index])
  ) {
    throw new Error(
      "Set Creative Director must return exactly one shot opportunity per selected idea."
    );
  }
  return { setDirection, ideas: parsedIdeas };
}

function parseRevisionPlan(value: unknown): RevisionPlan {
  if (!isRecord(value) || typeof value.refinedInstruction !== "string") {
    throw new Error("Revision planning returned invalid JSON.");
  }
  const refinedInstruction = value.refinedInstruction.trim();
  if (!refinedInstruction) {
    throw new Error("Revision planning returned an empty instruction.");
  }
  return { refinedInstruction };
}

function parseVisualQualityReview(value: unknown): VisualQualityReview {
  if (!isRecord(value)) {
    throw new Error("Visual QC returned invalid JSON.");
  }
  const decision = readEnum(value.decision, ["pass", "revise"], "decision");
  const density = readEnum(
    value.density,
    ["controlled", "too-dense", "too-empty"],
    "density"
  );
  const aiAppearance = readEnum(
    value.aiAppearance,
    ["credible", "noticeable", "obvious"],
    "aiAppearance"
  );
  const aiLikelihoodPercent = value.aiLikelihoodPercent;
  if (
    typeof aiLikelihoodPercent !== "number" ||
    !Number.isInteger(aiLikelihoodPercent) ||
    aiLikelihoodPercent < 0 ||
    aiLikelihoodPercent > 100
  ) {
    throw new Error(
      "Visual QC aiLikelihoodPercent must be an integer between 0 and 100."
    );
  }
  const revisionInstruction =
    typeof value.revisionInstruction === "string"
      ? value.revisionInstruction.trim()
      : "";
  if (decision === "revise" && !revisionInstruction) {
    throw new Error("Visual QC revision requires a revisionInstruction.");
  }
  return {
    decision,
    density,
    aiAppearance,
    aiLikelihoodPercent,
    strengths: readStringArray(value.strengths, "strengths"),
    issues: readStringArray(value.issues, "issues"),
    revisionInstruction
  };
}

function parseAlbumPanelSeparationReview(
  value: unknown,
  panelCount: number
): AlbumPanelSeparationReview {
  if (!isRecord(value)) {
    throw new Error("Album Panel QC returned invalid JSON.");
  }
  const decision = readEnum(value.decision, ["pass", "revise"], "decision");
  if (
    !Array.isArray(value.affectedPanels) ||
    value.affectedPanels.some(
      (panel) =>
        !Number.isInteger(panel) ||
        Number(panel) < 1 ||
        Number(panel) > panelCount
    )
  ) {
    throw new Error("affectedPanels must contain valid panel numbers.");
  }
  const affectedPanels = Array.from(
    new Set(value.affectedPanels.map((panel) => Number(panel)))
  ).sort((left, right) => left - right);
  const issue = typeof value.issue === "string" ? value.issue.trim() : "";
  const revisionInstruction =
    typeof value.revisionInstruction === "string"
      ? value.revisionInstruction.trim()
      : "";
  if (
    decision === "revise" &&
    (!affectedPanels.length || !issue || !revisionInstruction)
  ) {
    throw new Error(
      "Album Panel QC revision requires affected panels, an issue, and a revisionInstruction."
    );
  }
  if (decision === "pass" && affectedPanels.length) {
    throw new Error("Album Panel QC pass cannot include affected panels.");
  }
  return {
    decision,
    affectedPanels,
    issue,
    revisionInstruction
  };
}

async function loadSetCreativeDirectorPrompt(): Promise<string> {
  return readFile(
    join(
      process.cwd(),
      "agent_prompt",
      "versions",
      "2026-07-30-design-system-new-flow-v1",
      "prompts",
      "00-set-creative-director.md"
    ),
    "utf8"
  );
}

async function loadVisualQcPrompt(): Promise<string> {
  return readFile(
    join(
      process.cwd(),
      "agent_prompt",
      "versions",
      "2026-07-30-design-system-new-flow-v1",
      "prompts",
      "04-visual-qc.md"
    ),
    "utf8"
  );
}

async function loadAlbumPanelQcPrompt(): Promise<string> {
  return readFile(
    join(process.cwd(), "agent_prompt", "agent_album_panel_qc.md"),
    "utf8"
  );
}

async function writeTraceSafely(
  writeTrace: DesignSystemFlowTraceWriter | undefined,
  trace: DesignSystemFlowTrace
): Promise<void> {
  if (!writeTrace) return;
  try {
    await writeTrace(trace);
  } catch (error) {
    console.warn("Could not write Design System flow trace.", error);
  }
}

async function readJsonResponse(
  response: Response,
  label: string
): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) throw new Error(`${label} returned an empty response.`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} returned a non-JSON response.`);
  }
}

function extractResponseText(payload: unknown): string {
  if (isRecord(payload) && typeof payload.output_text === "string") {
    return payload.output_text;
  }
  if (!isRecord(payload) || !Array.isArray(payload.output)) {
    throw new Error("Agent response did not include output text.");
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
  throw new Error("Agent response did not include output text.");
}

async function readProviderErrorDetail(response: Response): Promise<string> {
  const text = await response.text();
  if (!text.trim()) return "";
  try {
    const payload = JSON.parse(text) as unknown;
    if (
      isRecord(payload) &&
      isRecord(payload.error) &&
      typeof payload.error.message === "string"
    ) {
      return payload.error.message.replace(/\s+/g, " ").trim().slice(0, 300);
    }
  } catch {
    // Plain text is summarized below.
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 300);
}

function readNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function readStringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field} must be an array of strings.`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function readEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${field} must be one of: ${allowed.join(", ")}.`);
  }
  return value as T[number];
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown agent error.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const creativeSetDirectionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    setDirection: { type: "string" },
    ideas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          directionId: { type: "string" },
          shotOpportunity: { type: "string" }
        },
        required: ["directionId", "shotOpportunity"]
      }
    }
  },
  required: ["setDirection", "ideas"]
} as const;

const revisionPlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    refinedInstruction: { type: "string" }
  },
  required: ["refinedInstruction"]
} as const;

const visualQualityReviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    decision: { type: "string", enum: ["pass", "revise"] },
    density: {
      type: "string",
      enum: ["controlled", "too-dense", "too-empty"]
    },
    aiAppearance: {
      type: "string",
      enum: ["credible", "noticeable", "obvious"]
    },
    aiLikelihoodPercent: { type: "integer", minimum: 0, maximum: 100 },
    strengths: { type: "array", items: { type: "string" } },
    issues: { type: "array", items: { type: "string" } },
    revisionInstruction: { type: "string" }
  },
  required: [
    "decision",
    "density",
    "aiAppearance",
    "aiLikelihoodPercent",
    "strengths",
    "issues",
    "revisionInstruction"
  ]
} as const;

const albumPanelSeparationReviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    decision: { type: "string", enum: ["pass", "revise"] },
    affectedPanels: {
      type: "array",
      items: { type: "integer", minimum: 1, maximum: 4 }
    },
    issue: { type: "string" },
    revisionInstruction: { type: "string" }
  },
  required: [
    "decision",
    "affectedPanels",
    "issue",
    "revisionInstruction"
  ]
} as const;
