import { resolveConvertCakeAuthorization } from "../shared/convert-cake-auth";

type FetchLike = typeof fetch;

export interface AnalyzeGuidelineEndpointEnv {
  OPENAI_API_KEY?: string;
  OPENAI_GUIDELINE_ANALYSIS_MODEL?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

export interface AnalyzeGuidelineEndpointOptions {
  request: Request;
  env: AnalyzeGuidelineEndpointEnv;
  fetchImpl?: FetchLike;
}

type AnalyzeGuidelineRequest =
  | { fileUrl: string; mimeType: string; text?: undefined }
  | { text: string; fileUrl?: undefined; mimeType?: undefined };

interface GuidelineAnalysis {
  summary: string;
  primaryColors: readonly string[];
  secondaryColors: readonly string[];
}

const DEFAULT_MODEL = "gpt-5.6-terra";
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export async function handleAnalyzeGuidelineRequest({
  request,
  env,
  fetchImpl = fetch
}: AnalyzeGuidelineEndpointOptions): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }

  try {
    const apiKey = env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return jsonResponse(
        { ok: false, error: "OPENAI_API_KEY is required." },
        500
      );
    }

    const auth = await resolveConvertCakeAuthorization(request, env, fetchImpl);
    if (!auth.authorized) {
      return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
    }

    const input = parseRequestBody(await request.json());
    const model = env.OPENAI_GUIDELINE_ANALYSIS_MODEL?.trim() || DEFAULT_MODEL;

    const payload = await callResponsesApi({
      apiKey,
      model,
      fetchImpl,
      input
    });
    const analysis = parseAnalysis(extractResponseText(payload));

    return jsonResponse({
      ok: true,
      summary: analysis.summary,
      primaryColors: analysis.primaryColors,
      secondaryColors: analysis.secondaryColors
    });
  } catch (error) {
    return jsonResponse({ ok: false, error: readableError(error) }, 500);
  }
}

async function callResponsesApi({
  apiKey,
  model,
  fetchImpl,
  input
}: {
  apiKey: string;
  model: string;
  fetchImpl: FetchLike;
  input: AnalyzeGuidelineRequest;
}): Promise<unknown> {
  const attachment: Record<string, unknown> =
    input.text !== undefined
      ? { type: "input_text", text: `Guideline text:\n${input.text}` }
      : input.mimeType === "application/pdf"
        ? {
            type: "input_file",
            filename: "brand-guideline.pdf",
            file_url: input.fileUrl
          }
        : {
            type: "input_image",
            image_url: input.fileUrl,
            detail: "auto"
          };

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
          content: [{ type: "input_text", text: buildPrompt() }, attachment]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "moons_guideline_analysis",
          strict: true,
          schema: analysisSchema
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(
      await readableOpenAiError(response, "OpenAI guideline analysis")
    );
  }

  return readJsonResponse(response, "OpenAI guideline analysis");
}

async function readableOpenAiError(
  response: Response,
  label: string
): Promise<string> {
  const body = await response.text();

  try {
    const parsed = JSON.parse(body) as unknown;
    if (
      isRecord(parsed) &&
      isRecord(parsed.error) &&
      typeof parsed.error.message === "string"
    ) {
      return `${label} failed: ${parsed.error.message}`;
    }
  } catch {
    // Body wasn't JSON — fall through to a status-based message.
  }

  if (response.status === 429) {
    return `${label} failed: rate limit or quota exceeded (429). Wait a moment and try again, or check the OpenAI account's usage/billing limits.`;
  }

  return `${label} failed: ${response.status}`;
}

function buildPrompt(): string {
  return [
    "You are a brand designer analyzing an uploaded brand guideline — a document, image, or pasted text.",
    "",
    "Extract three things:",
    "1. A concise summary (2-4 sentences, in Thai) of the brand's mood, tone, and visual style — suitable to store as a single Brand Kit rule describing how the brand should look and feel. Write it in natural, polished Thai, not a translated feel. Brand names, product names, and technical terms may stay in English.",
    "2. The brand's primary colors as hex codes — the main, dominant brand colors (usually 1-3). Only include colors that are clearly established brand colors, not incidental background, photo, or shadow colors, and do not invent colors that aren't stated or shown.",
    "3. The brand's secondary colors as hex codes — supporting or accent colors used alongside the primary colors (can be empty if none are clearly established).",
    "",
    "Return each color as a full 6-digit hex code like #1A2B3C.",
    "",
    "If the guideline does not contain enough information to determine a color palette (for example, plain text with no colors mentioned), return empty color arrays rather than guessing.",
    "",
    "Return only JSON matching the schema."
  ].join("\n");
}

const analysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    primaryColors: {
      type: "array",
      items: { type: "string" }
    },
    secondaryColors: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: ["summary", "primaryColors", "secondaryColors"]
} as const;

function parseAnalysis(text: string): GuidelineAnalysis {
  const parsed = JSON.parse(text) as unknown;
  const value = readRecord(parsed, "guideline analysis payload");
  const summary = readString(value.summary, "summary");

  if (!Array.isArray(value.primaryColors)) {
    throw new Error("primaryColors must be an array.");
  }
  if (!Array.isArray(value.secondaryColors)) {
    throw new Error("secondaryColors must be an array.");
  }

  const filterHex = (values: unknown[]) =>
    values.filter(
      (item): item is string =>
        typeof item === "string" && HEX_COLOR_PATTERN.test(item)
    );

  return {
    summary,
    primaryColors: filterHex(value.primaryColors),
    secondaryColors: filterHex(value.secondaryColors)
  };
}

function extractResponseText(payload: unknown): string {
  if (isRecord(payload) && typeof payload.output_text === "string") {
    return payload.output_text;
  }

  if (!isRecord(payload) || !Array.isArray(payload.output)) {
    throw new Error("OpenAI guideline analysis response did not include output text.");
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

  throw new Error("OpenAI guideline analysis response did not include output text.");
}

function parseRequestBody(value: unknown): AnalyzeGuidelineRequest {
  if (!isRecord(value)) throw new Error("Invalid guideline analysis request.");

  if (typeof value.text === "string") {
    if (!value.text.trim()) throw new Error("text must not be empty.");
    return { text: value.text };
  }

  return {
    fileUrl: readString(value.fileUrl, "fileUrl"),
    mimeType: readString(value.mimeType, "mimeType")
  };
}

function readRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${field} must be an object.`);
  return value;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function readableError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unknown guideline analysis error.";
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
