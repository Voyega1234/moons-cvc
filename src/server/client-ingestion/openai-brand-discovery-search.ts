import type { SearchFallbackClient } from "./client-ingestion-harness.js";

type FetchLike = typeof fetch;

export interface OpenAiBrandDiscoverySearchOptions {
  apiKey: string;
  model?: string;
  endpoint?: string;
  fetchImpl?: FetchLike;
  maxAttempts?: number;
  retryDelayMs?: number;
}

export interface OpenAiBrandDiscoveryResult {
  provider: "openai";
  model: string;
  outputText: string;
  citations: { title: string; url: string }[];
  rawPayload: unknown;
}

const DEFAULT_MODEL = "gpt-5.6-terra";
const DEFAULT_ENDPOINT = "https://api.openai.com/v1/responses";

export class OpenAiBrandDiscoverySearch implements SearchFallbackClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly fetchImpl: FetchLike;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;

  constructor({
    apiKey,
    model = DEFAULT_MODEL,
    endpoint = DEFAULT_ENDPOINT,
    fetchImpl = fetch,
    maxAttempts = 2,
    retryDelayMs = 250
  }: OpenAiBrandDiscoverySearchOptions) {
    if (!apiKey.trim()) throw new Error("OPENAI_API_KEY is required.");
    this.apiKey = apiKey;
    this.model = model;
    this.endpoint = endpoint;
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
          tools: [
            {
              type: "web_search",
              search_context_size: "medium",
              user_location: {
                type: "approximate",
                country: "TH",
                city: "Bangkok",
                region: "Bangkok",
                timezone: "Asia/Bangkok"
              }
            }
          ],
          tool_choice: "required",
          include: ["web_search_call.action.sources"],
          input: buildDiscoveryPrompt(input)
        })
      });
    } catch (error) {
      throw new OpenAiBrandDiscoveryError(
        `OpenAI brand discovery request failed: ${readableError(error)}`,
        null,
        true
      );
    }

    if (!response.ok) throw await readRequestError(response);

    const payload = (await response.json()) as unknown;
    const extracted = extractOpenAiBrandDiscoveryOutput(payload);
    return {
      provider: "openai",
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
    if (!isRecord(entry) || typeof entry.url !== "string") continue;
    citations.push({
      title:
        typeof entry.title === "string" && entry.title.trim()
          ? entry.title.trim()
          : entry.url,
      url: entry.url
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
  response: Response
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
      ? `OpenAI brand discovery failed (${context}): ${detailText}`
      : `OpenAI brand discovery failed (${context}).`,
    response.status,
    isRetryableStatus(response.status)
  );
}

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
