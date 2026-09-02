import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ImagePromptAgentTraceWriter,
  ImagePromptProvider
} from "./image-prompt-agent.js";
import type { ReferenceImageInput } from "./openai-images-client.js";

type FetchLike = typeof fetch;

export interface ReferenceDesignGrammar {
  artworkConcept: string;
  keyVisualGrammar: string;
  compositionGrammar: string;
  graphicDeviceLogic: string;
  hierarchyAndDensity: string;
  secondaryAndFooterGrammar: string;
  conceptTranslation: string;
  preserve: readonly string[];
  replace: readonly string[];
}

const DEFAULT_MODEL = "gpt-5.6-terra";
const OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/responses";

export async function interpretReferenceDesign({
  apiKey,
  model = DEFAULT_MODEL,
  provider = "openai",
  fetchImpl,
  mode,
  references,
  campaign,
  writeTrace,
  loadPrompt = defaultLoadPrompt,
  usePlaceholderCopy = false
}: {
  apiKey: string;
  model?: string;
  provider?: ImagePromptProvider;
  fetchImpl: FetchLike;
  mode: Parameters<NonNullable<ImagePromptAgentTraceWriter>>[0]["mode"];
  references: readonly ReferenceImageInput[];
  campaign: {
    concept: string;
    objective: string;
    headline: string;
    targetRatio: string;
  };
  writeTrace?: ImagePromptAgentTraceWriter;
  loadPrompt?: () => Promise<string>;
  usePlaceholderCopy?: boolean;
}): Promise<ReferenceDesignGrammar> {
  if (!references.length) {
    throw new Error("Reference-led generation requires at least one Hook reference.");
  }
  const endpoint = provider === "openrouter" ? OPENROUTER_ENDPOINT : OPENAI_ENDPOINT;
  const providerLabel = provider === "openrouter" ? "OpenRouter" : "OpenAI";

  const inputText = [
    (await loadPrompt()).trim(),
    "",
    ...(usePlaceholderCopy
      ? [
          "PLACEHOLDER COPY MODE",
          "The concept/objective/headline below are the real, approved creative idea — use them fully to inform artworkConcept, keyVisualGrammar, compositionGrammar, hierarchyAndDensity, and every other field, so the design genuinely fits this idea. However, the artwork's final visible headline/cta text will be overridden to generic layout-placeholder labels regardless of what is given here, so no field you return (especially conceptTranslation) may suggest, quote, imply, or embed any specific literal wording, tagline, or copy line — describe only the structure, mechanism, and mood.",
          ""
        ]
      : []),
    "APPROVED CAMPAIGN TO TRANSLATE",
    JSON.stringify(campaign, null, 2),
    "",
    "REFERENCE IMAGE ORDER",
    JSON.stringify(
      references.map((reference, index) => ({
        image: index + 1,
        label: reference.label ?? "Primary reference"
      })),
      null,
      2
    )
  ].join("\n");

  try {
    const response = await fetchImpl(endpoint, {
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
            content: [
              { type: "input_text", text: inputText },
              ...references.map((reference) => ({
                type: "input_image" as const,
                image_url: `data:${reference.mimeType};base64,${reference.bytes.toString("base64")}`,
                detail: "high" as const
              }))
            ]
          }
        ],
        reasoning: { effort: "low" },
        text: {
          format: {
            type: "json_schema",
            name: "moons_reference_design_grammar",
            strict: true,
            schema: referenceDesignGrammarSchema
          }
        }
      })
    });

    if (!response.ok) {
      throw new Error(
        `${providerLabel} reference interpreter failed: ${response.status}${await responseDetail(response)}`
      );
    }

    const payload = (await response.json()) as unknown;
    const grammar = parseReferenceDesignGrammar(
      JSON.parse(extractResponseText(payload)) as unknown
    );
    await writeTrace?.({
      createdAt: new Date().toISOString(),
      provider,
      endpoint: provider === "openrouter" ? "/api/v1/responses" : "/v1/responses",
      model,
      mode,
      stage: "reference-interpreter",
      status: "succeeded",
      inputText,
      responsePrompt: JSON.stringify(grammar)
    });
    return grammar;
  } catch (error) {
    await writeTrace?.({
      createdAt: new Date().toISOString(),
      provider,
      endpoint: provider === "openrouter" ? "/api/v1/responses" : "/v1/responses",
      model,
      mode,
      stage: "reference-interpreter",
      status: "failed",
      inputText,
      error: error instanceof Error ? error.message : "Unknown interpreter error."
    });
    throw error;
  }
}

const referenceDesignGrammarSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "artworkConcept",
    "keyVisualGrammar",
    "compositionGrammar",
    "graphicDeviceLogic",
    "hierarchyAndDensity",
    "secondaryAndFooterGrammar",
    "conceptTranslation",
    "preserve",
    "replace"
  ],
  properties: {
    artworkConcept: { type: "string" },
    keyVisualGrammar: { type: "string" },
    compositionGrammar: { type: "string" },
    graphicDeviceLogic: { type: "string" },
    hierarchyAndDensity: { type: "string" },
    secondaryAndFooterGrammar: { type: "string" },
    conceptTranslation: { type: "string" },
    preserve: { type: "array", items: { type: "string" } },
    replace: { type: "array", items: { type: "string" } }
  }
} as const;

function parseReferenceDesignGrammar(value: unknown): ReferenceDesignGrammar {
  if (!isRecord(value)) throw new Error("Reference interpreter returned invalid JSON.");
  const fields = [
    "artworkConcept",
    "keyVisualGrammar",
    "compositionGrammar",
    "graphicDeviceLogic",
    "hierarchyAndDensity",
    "secondaryAndFooterGrammar",
    "conceptTranslation"
  ] as const;
  for (const field of fields) {
    if (typeof value[field] !== "string" || !value[field].trim()) {
      throw new Error(`Reference interpreter omitted ${field}.`);
    }
  }
  if (!isStringArray(value.preserve) || !isStringArray(value.replace)) {
    throw new Error("Reference interpreter returned invalid preserve/replace rules.");
  }
  return value as unknown as ReferenceDesignGrammar;
}

function extractResponseText(payload: unknown): string {
  if (isRecord(payload) && typeof payload.output_text === "string") {
    return payload.output_text;
  }
  if (isRecord(payload) && Array.isArray(payload.output)) {
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
  }
  throw new Error("Reference interpreter response did not include output text.");
}

async function responseDetail(response: Response): Promise<string> {
  const text = await response.text();
  if (!text.trim()) return "";
  try {
    const payload = JSON.parse(text) as unknown;
    if (
      isRecord(payload) &&
      isRecord(payload.error) &&
      typeof payload.error.message === "string"
    ) {
      return ` — ${payload.error.message.replace(/\s+/g, " ").trim().slice(0, 300)}`;
    }
  } catch {
    // Fall through to bounded plain text.
  }
  return ` — ${text.replace(/\s+/g, " ").trim().slice(0, 300)}`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function defaultLoadPrompt(): Promise<string> {
  return readFile(
    join(process.cwd(), "agent_prompt", "agent_reference_interpreter.md"),
    "utf8"
  );
}
