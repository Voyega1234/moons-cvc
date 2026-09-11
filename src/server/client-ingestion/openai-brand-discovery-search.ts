import type { SearchFallbackClient } from "./client-ingestion-harness.js";
import { openRouterTraceEnvironment } from "../shared/openrouter-trace.js";

type FetchLike = typeof fetch;

export interface OpenAiBrandDiscoverySearchOptions {
  apiKey: string;
  model?: string;
  provider?: "openai" | "openrouter";
  endpoint?: string;
  fetchImpl?: FetchLike;
  maxAttempts?: number;
  retryDelayMs?: number;
}

export interface OpenAiBrandDiscoveryResult {
  provider: "openai" | "openrouter";
  model: string;
  outputText: string;
  citations: { title: string; url: string }[];
  rawPayload: unknown;
}

const DEFAULT_MODEL = "gpt-5.6-terra";
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const OPENROUTER_RESPONSES_ENDPOINT = "https://openrouter.ai/api/v1/responses";

export class OpenAiBrandDiscoverySearch implements SearchFallbackClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly provider: "openai" | "openrouter";
  private readonly endpoint: string;
  private readonly fetchImpl: FetchLike;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;

  constructor({
    apiKey,
    model = DEFAULT_MODEL,
    provider = "openai",
    endpoint,
    fetchImpl = fetch,
    maxAttempts = 2,
    retryDelayMs = 250
  }: OpenAiBrandDiscoverySearchOptions) {
    if (!apiKey.trim()) {
      throw new Error(
        provider === "openrouter"
          ? "OPENROUTER_API_KEY is required."
          : "OPENAI_API_KEY is required."
      );
    }
    this.apiKey = apiKey;
    this.model = model;
    this.provider = provider;
    this.endpoint =
      endpoint ??
      (provider === "openrouter"
        ? OPENROUTER_RESPONSES_ENDPOINT
        : OPENAI_RESPONSES_ENDPOINT);
    this.fetchImpl = fetchImpl;
    this.maxAttempts = Math.max(1, Math.floor(maxAttempts));
    this.retryDelayMs = Math.max(0, retryDelayMs);
  }

  async search(
    input: Parameters<SearchFallbackClient["search"]>[0]
  ): Promise<OpenAiBrandDiscoveryResult> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await this.requestSearch(input);
      } catch (error) {
        lastError = error;
        if (attempt >= this.maxAttempts || !isRetryable(error)) throw error;
        await wait(this.retryDelayMs * attempt);
      }
    }

    throw lastError;
  }

  private async requestSearch(
    input: Parameters<SearchFallbackClient["search"]>[0]
  ): Promise<OpenAiBrandDiscoveryResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          store: false,
          tools:
            this.provider === "openrouter"
              ? [
                  {
                    type: "openrouter:web_search",
                    parameters: {
                      search_context_size: "medium",
                      max_total_results: 10,
                      user_location: thailandLocation
                    }
                  }
                ]
              : [
                  {
                    type: "web_search",
                    search_context_size: "medium",
                    user_location: thailandLocation
                  }
                ],
          tool_choice: "required",
          ...(this.provider === "openai"
            ? { include: ["web_search_call.action.sources"] }
            : {}),
          input: buildDiscoveryPrompt(input),
          ...(this.provider === "openrouter"
            ? {
                trace: {
                  trace_name: "moons_brand_discovery_search",
                  generation_name: "moons_brand_discovery_search",
                  feature: "client-ingestion",
                  environment: openRouterTraceEnvironment()
                }
              }
            : {})
        })
      });
    } catch (error) {
      throw new OpenAiBrandDiscoveryError(
        `${providerLabel(this.provider)} brand discovery request failed: ${readableError(error)}`,
        null,
        true
      );
    }

    if (!response.ok) throw await readRequestError(response, this.provider);

    const payload = (await response.json()) as unknown;
    const extracted = extractOpenAiBrandDiscoveryOutput(payload);
    return {
      provider: this.provider,
      model: this.model,
      ...extracted,
      rawPayload: payload
    };
  }
}

export function extractOpenAiBrandDiscoveryOutput(payload: unknown): {
  outputText: string;
  citations: { title: string; url: string }[];
} {
  if (!isRecord(payload)) return { outputText: "", citations: [] };

  const textParts: string[] = [];
  const citations: { title: string; url: string }[] = [];
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    textParts.push(payload.output_text.trim());
  }

  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      if (!isRecord(item)) continue;
      if (item.type === "web_search_call" && isRecord(item.action)) {
        collectCitations(item.action.sources, citations);
      }
      if (item.type !== "message" || !Array.isArray(item.content)) continue;
      for (const content of item.content) {
        if (!isRecord(content)) continue;
        if (
          content.type === "output_text" &&
          typeof content.text === "string" &&
          content.text.trim()
        ) {
          textParts.push(content.text.trim());
        }
        collectCitations(content.annotations, citations);
      }
    }
  }

  return {
    outputText: [...new Set(textParts)].join("\n\n"),
    citations: deduplicateCitations(citations)
  };
}

function buildDiscoveryPrompt(
  input: Parameters<SearchFallbackClient["search"]>[0]
): string {
  const questionnaireText = input.questionnaireText?.trim().slice(0, 6_000);
  return [
    `Research the brand "${input.clientName}" for a Creative Compass brand profile.`,
    "Focus on the brand's presence, customers, products, services, positioning, language, and channels in Thailand.",
    "Search in both Thai and English. Prefer official Thailand websites, official social or commerce profiles, and reputable Thai sources.",
    "Disambiguate the brand from similarly named businesses outside Thailand. Do not combine facts from namesakes.",
    "Report only grounded facts useful for creative work: what the brand sells, target audience, positioning, key products or services, tone, supported claims, and Thailand-specific market signals.",
    "State uncertainty clearly and do not invent missing information.",
    questionnaireText
      ? `Use this first-party onboarding context to identify the correct brand (do not treat it as independently verified public evidence):\n${questionnaireText}`
      : "No onboarding context was supplied beyond the brand name. Be especially careful about identity ambiguity."
  ].join("\n\n");
}

function collectCitations(
  value: unknown,
  citations: { title: string; url: string }[]
): void {
  if (!Array.isArray(value)) return;
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const citation = isRecord(entry.url_citation) ? entry.url_citation : entry;
    if (typeof citation.url !== "string") continue;
    citations.push({
      title:
        typeof citation.title === "string" && citation.title.trim()
          ? citation.title.trim()
          : citation.url,
      url: citation.url
    });
  }
}

function deduplicateCitations(
  citations: readonly { title: string; url: string }[]
): { title: string; url: string }[] {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    if (seen.has(citation.url)) return false;
    seen.add(citation.url);
    return true;
  });
}

class OpenAiBrandDiscoveryError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "OpenAiBrandDiscoveryError";
  }
}

async function readRequestError(
  response: Response,
  provider: "openai" | "openrouter"
): Promise<OpenAiBrandDiscoveryError> {
  const requestId = response.headers.get("x-request-id")?.trim();
  const rawBody = await response.text();
  const detail = parseErrorDetail(rawBody);
  const context = [String(response.status), requestId && `request ${requestId}`]
    .filter(Boolean)
    .join(", ");
  const detailText = [detail.code, detail.message].filter(Boolean).join(" — ");
  return new OpenAiBrandDiscoveryError(
    detailText
      ? `${providerLabel(provider)} brand discovery failed (${context}): ${detailText}`
      : `${providerLabel(provider)} brand discovery failed (${context}).`,
    response.status,
    isRetryableStatus(response.status)
  );
}

function providerLabel(provider: "openai" | "openrouter"): string {
  return provider === "openrouter" ? "OpenRouter" : "OpenAI";
}

const thailandLocation = {
  type: "approximate",
  country: "TH",
  city: "Bangkok",
  region: "Bangkok",
  timezone: "Asia/Bangkok"
} as const;

function parseErrorDetail(rawBody: string): { code: string; message: string } {
  try {
    const payload = JSON.parse(rawBody) as unknown;
    if (isRecord(payload) && isRecord(payload.error)) {
      return {
        code:
          typeof payload.error.code === "string" ? payload.error.code.trim() : "",
        message:
          typeof payload.error.message === "string"
            ? payload.error.message.trim().slice(0, 1_200)
            : ""
      };
    }
  } catch {
    // Use the bounded plain-text response below.
  }
  return {
    code: "",
    message: rawBody.replace(/\s+/g, " ").trim().slice(0, 1_200)
  };
}

function isRetryable(error: unknown): boolean {
  return error instanceof OpenAiBrandDiscoveryError && error.retryable;
}

function isRetryableStatus(status: number): boolean {
  return [408, 409, 425, 429].includes(status) || status >= 500;
}

function wait(milliseconds: number): Promise<void> {
  return milliseconds > 0
    ? new Promise((resolve) => setTimeout(resolve, milliseconds))
    : Promise.resolve();
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown network error.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
