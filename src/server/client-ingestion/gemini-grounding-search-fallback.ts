import type { SearchFallbackClient } from "./client-ingestion-harness.js";

type FetchLike = typeof fetch;

export interface GeminiGroundingSearchFallbackOptions {
  apiKey: string;
  model?: string;
  endpoint?: string;
  fetchImpl?: FetchLike;
}

export interface GeminiGroundingSearchResult {
  provider: "gemini";
  model: string;
  outputText: string;
  searchQueries: string[];
  citations: {
    title: string;
    url: string;
  }[];
  rawPayload: unknown;
}

const DEFAULT_MODEL = "gemini-3.5-flash";
const DEFAULT_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

export class GeminiGroundingSearchFallback implements SearchFallbackClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly fetchImpl: FetchLike;

  constructor({
    apiKey,
    model = DEFAULT_MODEL,
    endpoint = DEFAULT_ENDPOINT,
    fetchImpl = fetch
  }: GeminiGroundingSearchFallbackOptions) {
    if (!apiKey.trim()) throw new Error("GEMINI_API_KEY is required.");

    this.apiKey = apiKey;
    this.model = model;
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl;
  }

  async search(
    input: Parameters<SearchFallbackClient["search"]>[0]
  ): Promise<GeminiGroundingSearchResult> {
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": this.apiKey
      },
      body: JSON.stringify({
        model: this.model,
        input: buildGroundingPrompt(input.clientName, input.facebookUrl),
        tools: [{ type: "google_search" }]
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini grounding search failed: ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    const extracted = extractGeminiGroundingOutput(payload);

    return {
      provider: "gemini",
      model: this.model,
      ...extracted,
      rawPayload: payload
    };
  }
}

export function extractGeminiGroundingOutput(payload: unknown): {
  outputText: string;
  searchQueries: string[];
  citations: { title: string; url: string }[];
} {
  const outputText: string[] = [];
  const searchQueries: string[] = [];
  const citations: { title: string; url: string }[] = [];

  if (!isRecord(payload) || !Array.isArray(payload.steps)) {
    return { outputText: "", searchQueries, citations };
  }

  for (const step of payload.steps) {
    if (!isRecord(step)) continue;

    if (step.type === "google_search_call" && isRecord(step.arguments)) {
      const queries = step.arguments.queries;
      if (Array.isArray(queries)) {
        searchQueries.push(
          ...queries.filter((query): query is string => typeof query === "string")
        );
      }
    }

    if (step.type === "model_output" && Array.isArray(step.content)) {
      for (const content of step.content) {
        if (!isRecord(content) || content.type !== "text") continue;
        if (typeof content.text === "string") outputText.push(content.text);

        if (Array.isArray(content.annotations)) {
          for (const annotation of content.annotations) {
            if (
              isRecord(annotation) &&
              annotation.type === "url_citation" &&
              typeof annotation.url === "string"
            ) {
              citations.push({
                title:
                  typeof annotation.title === "string"
                    ? annotation.title
                    : annotation.url,
                url: annotation.url
              });
            }
          }
        }
      }
    }
  }

  return {
    outputText: outputText.join("\n\n"),
    searchQueries,
    citations
  };
}

function buildGroundingPrompt(clientName: string, facebookUrl: string): string {
  return [
    `Find public brand information for "${clientName}".`,
    `Facebook URL that failed or had limited access: ${facebookUrl}`,
    "",
    "Focus on facts useful for creative content generation:",
    "- what the brand sells",
    "- audience",
    "- tone and positioning",
    "- visual or product signals",
    "- official website or social profiles if visible",
    "",
    "Return grounded facts with citations. Do not invent missing information."
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
