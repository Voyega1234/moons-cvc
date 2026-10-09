import { extractStructuredJsonText, StructuredOutputError } from "../shared/structured-output.js";

export type HookProvider = "openai" | "openrouter" | "gemini" | "vertex";

export function googleHookEndpoint(provider: "gemini" | "vertex", model: string): string {
  const path = encodeURIComponent(model);
  return provider === "vertex"
    ? `https://aiplatform.googleapis.com/v1/publishers/google/models/${path}:generateContent`
    : `https://generativelanguage.googleapis.com/v1beta/models/${path}:generateContent`;
}

export async function callGoogleHookApi({ provider, apiKey, model, fetchImpl, text, schema, schemaName, maxTokens, search }: {
  provider: "gemini" | "vertex";
  apiKey: string;
  model: string;
  fetchImpl: typeof fetch;
  text: string;
  schema: unknown;
  schemaName: string;
  maxTokens: number;
  search: boolean;
}): Promise<unknown> {
  const label = `${provider} ${schemaName} (${model})`;
  const response = await fetchImpl(googleHookEndpoint(provider, model), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        responseMimeType: "application/json",
        responseJsonSchema: schema
      },
      ...(search ? { tools: [{ googleSearch: {} }] } : {}),
      ...(provider === "vertex" ? { labels: { moons_stage: schemaName } } : {})
    })
  });
  const rawText = await response.text();
  let raw: unknown;
  try { raw = JSON.parse(rawText); } catch {
    if (response.ok) throw new StructuredOutputError("invalid_json", `${label} returned non-JSON data.`);
    throw new Error(`${label} failed: ${response.status} — non-JSON response.`);
  }
  if (!response.ok) {
    const error = record(record(raw).error);
    const detail = typeof error.message === "string"
      ? error.message.split(apiKey).join("[redacted]").slice(0, 500) : "Provider request failed.";
    throw new Error(`${label} failed: ${response.status} — ${detail}`);
  }
  const payload = normalizeGoogleHookResponse(raw);
  extractStructuredJsonText(payload, label);
  return payload;
}

// Keep the original grounding payload and expose final text to the existing validators.
export function normalizeGoogleHookResponse(raw: unknown): Record<string, unknown> {
  const payload = record(raw);
  const candidate = record(Array.isArray(payload.candidates) ? payload.candidates[0] : undefined);
  const content = record(candidate.content);
  const parts = Array.isArray(content.parts) ? content.parts.map(record) : [];
  const grounding = record(candidate.groundingMetadata);
  const chunks = Array.isArray(grounding.groundingChunks) ? grounding.groundingChunks.map(record) : [];
  const annotations = chunks.flatMap((chunk) => {
    const web = record(chunk.web);
    return typeof web.uri === "string"
      ? [{ type: "url_citation", url: web.uri, title: web.title }] : [];
  });
  const queries = Array.isArray(grounding.webSearchQueries) ? grounding.webSearchQueries : [];
  const blocked = record(payload.promptFeedback).blockReason ||
    (candidate.finishReason && !["STOP", "MAX_TOKENS"].includes(String(candidate.finishReason)));
  return {
    ...payload,
    output_text: parts.filter((part) => !part.thought && typeof part.text === "string").map((part) => part.text).join(""),
    ...(candidate.finishReason === "MAX_TOKENS" ? { status: "incomplete" } : {}),
    ...(blocked ? { incomplete_details: { reason: "content_filter" } } : {}),
    output: [
      ...queries.map((query) => ({ type: "web_search_call", query })),
      { type: "message", content: [{ type: "output_text", annotations }] }
    ]
  };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
