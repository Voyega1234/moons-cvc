type FetchLike = typeof fetch;

export interface AiUsageTrackingContext {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  accessToken: string | null;
  ownerUserId: string | null;
  clientId: string | null;
  workspaceRunId: string;
  operation: "hook-generation" | "artwork-generation";
}

interface AiUsageEvent {
  owner_user_id: string;
  client_id: string | null;
  workspace_run_id: string;
  request_group_id: string;
  sequence_no: number;
  operation: AiUsageTrackingContext["operation"];
  stage: string;
  modality: "text" | "image";
  provider: "openai" | "openrouter";
  model: string;
  endpoint: string;
  provider_request_id: string | null;
  http_status: number;
  status: "succeeded" | "failed";
  duration_ms: number;
  input_tokens: number;
  cached_input_tokens: number;
  cache_write_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  input_text_tokens: number;
  input_image_tokens: number;
  output_image_tokens: number;
  total_tokens: number;
  web_search_requests: number;
  image_count: number;
  image_size: string | null;
  image_quality: string | null;
  provider_reported_cost_usd: number | null;
  raw_usage: Record<string, unknown>;
}

export function createAiUsageTrackingFetch({
  fetchImpl,
  context
}: {
  fetchImpl: FetchLike;
  context: AiUsageTrackingContext;
}): FetchLike {
  const requestGroupId = crypto.randomUUID();
  let sequence = 0;

  return (async (input: URL | RequestInfo, init?: RequestInit) => {
    const providerRequest = parseProviderRequest(input, init);
    if (!providerRequest) return fetchImpl(input, init);

    const sequenceNo = (sequence += 1);
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetchImpl(input, init);
    } catch (error) {
      try {
        await persistAiUsageEvent({
          fetchImpl,
          context,
          event: buildTransportFailureEvent({
            context,
            requestGroupId,
            sequenceNo,
            providerRequest,
            durationMs: Math.max(0, Date.now() - startedAt)
          })
        });
      } catch (persistenceError) {
        console.warn("Could not record AI usage event.", persistenceError);
      }
      throw error;
    }
    const durationMs = Math.max(0, Date.now() - startedAt);

    try {
      const payload = await readResponsePayload(response.clone());
      const event = buildUsageEvent({
        context,
        requestGroupId,
        sequenceNo,
        providerRequest,
        response,
        payload,
        durationMs
      });
      await persistAiUsageEvent({ fetchImpl, context, event });
    } catch (error) {
      console.warn("Could not record AI usage event.", error);
    }

    return response;
  }) as FetchLike;
}

function parseProviderRequest(
  input: URL | RequestInfo,
  init: RequestInit | undefined
): {
  provider: "openai" | "openrouter";
  endpoint: string;
  modality: "text" | "image";
  model: string;
  stage: string;
  imageSize: string | null;
  imageQuality: string | null;
  requestedImageCount: number;
} | null {
  const url = requestUrl(input);
  if (!url) return null;
  const isOpenAi = url.hostname === "api.openai.com";
  const isOpenRouter = url.hostname === "openrouter.ai";
  if (!isOpenAi && !isOpenRouter) return null;

  const isImage = /^\/v1\/images\/(?:generations|edits)$/.test(url.pathname);
  const isText =
    url.pathname === "/v1/responses" ||
    url.pathname === "/api/v1/chat/completions";
  if (!isImage && !isText) return null;

  const body = parseRequestBody(init?.body);
  const model = readBodyString(body, "model") || "unknown";
  const schemaName =
    nestedString(body, ["text", "format", "name"]) ||
    nestedString(body, ["response_format", "json_schema", "name"]);
  const imageOperation = url.pathname.endsWith("/edits")
    ? "image-edit"
    : "image-generation";

  return {
    provider: isOpenRouter ? "openrouter" : "openai",
    endpoint: url.pathname,
    modality: isImage ? "image" : "text",
    model,
    stage: schemaName || imageOperation,
    imageSize: readBodyString(body, "size") || null,
    imageQuality: readBodyString(body, "quality") || null,
    requestedImageCount: readBodyNumber(body, "n") || (isImage ? 1 : 0)
  };
}

function buildUsageEvent({
  context,
  requestGroupId,
  sequenceNo,
  providerRequest,
  response,
  payload,
  durationMs
}: {
  context: AiUsageTrackingContext;
  requestGroupId: string;
  sequenceNo: number;
  providerRequest: NonNullable<ReturnType<typeof parseProviderRequest>>;
  response: Response;
  payload: unknown;
  durationMs: number;
}): AiUsageEvent {
  const usage = isRecord(payload) && isRecord(payload.usage) ? payload.usage : {};
  const inputDetails = firstRecord(
    usage.input_tokens_details,
    usage.prompt_tokens_details
  );
  const outputDetails = firstRecord(
    usage.output_tokens_details,
    usage.completion_tokens_details
  );
  const inputTokens = firstNumber(usage.input_tokens, usage.prompt_tokens);
  const outputTokens = firstNumber(
    usage.output_tokens,
    usage.completion_tokens
  );
  const responseImageCount =
    isRecord(payload) && Array.isArray(payload.data) ? payload.data.length : 0;

  return {
    owner_user_id: context.ownerUserId || "",
    client_id: context.clientId,
    workspace_run_id: context.workspaceRunId,
    request_group_id: requestGroupId,
    sequence_no: sequenceNo,
    operation: context.operation,
    stage: providerRequest.stage,
    modality: providerRequest.modality,
    provider: providerRequest.provider,
    model:
      (isRecord(payload) && typeof payload.model === "string"
        ? payload.model
        : providerRequest.model) || "unknown",
    endpoint: providerRequest.endpoint,
    provider_request_id:
      response.headers.get("x-request-id")?.trim() ||
      (isRecord(payload) && typeof payload.id === "string" ? payload.id : null),
    http_status: response.status,
    status: response.ok ? "succeeded" : "failed",
    duration_ms: durationMs,
    input_tokens: inputTokens,
    cached_input_tokens: firstNumber(inputDetails.cached_tokens),
    cache_write_tokens: firstNumber(inputDetails.cache_write_tokens),
    output_tokens: outputTokens,
    reasoning_tokens: firstNumber(outputDetails.reasoning_tokens),
    input_text_tokens: firstNumber(inputDetails.text_tokens),
    input_image_tokens: firstNumber(inputDetails.image_tokens),
    output_image_tokens: firstNumber(outputDetails.image_tokens),
    total_tokens:
      firstNumber(usage.total_tokens) || inputTokens + outputTokens,
    web_search_requests: countWebSearchRequests(payload),
    image_count: response.ok
      ? responseImageCount || providerRequest.requestedImageCount
      : 0,
    image_size: providerRequest.imageSize,
    image_quality: providerRequest.imageQuality,
    provider_reported_cost_usd: firstNullableNumber(usage.cost),
    raw_usage: usage
  };
}

function buildTransportFailureEvent({
  context,
  requestGroupId,
  sequenceNo,
  providerRequest,
  durationMs
}: {
  context: AiUsageTrackingContext;
  requestGroupId: string;
  sequenceNo: number;
  providerRequest: NonNullable<ReturnType<typeof parseProviderRequest>>;
  durationMs: number;
}): AiUsageEvent {
  return {
    owner_user_id: context.ownerUserId || "",
    client_id: context.clientId,
    workspace_run_id: context.workspaceRunId,
    request_group_id: requestGroupId,
    sequence_no: sequenceNo,
    operation: context.operation,
    stage: providerRequest.stage,
    modality: providerRequest.modality,
    provider: providerRequest.provider,
    model: providerRequest.model,
    endpoint: providerRequest.endpoint,
    provider_request_id: null,
    http_status: 0,
    status: "failed",
    duration_ms: durationMs,
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_write_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    input_text_tokens: 0,
    input_image_tokens: 0,
    output_image_tokens: 0,
    total_tokens: 0,
    web_search_requests: 0,
    image_count: 0,
    image_size: providerRequest.imageSize,
    image_quality: providerRequest.imageQuality,
    provider_reported_cost_usd: null,
    raw_usage: {}
  };
}

async function persistAiUsageEvent({
  fetchImpl,
  context,
  event
}: {
  fetchImpl: FetchLike;
  context: AiUsageTrackingContext;
  event: AiUsageEvent;
}): Promise<void> {
  const supabaseUrl = context.supabaseUrl?.trim().replace(/\/$/, "");
  const anonKey = context.supabaseAnonKey?.trim();
  if (
    !supabaseUrl ||
    !anonKey ||
    !context.accessToken ||
    !context.ownerUserId
  ) {
    return;
  }

  const response = await fetchImpl(`${supabaseUrl}/rest/v1/ai_usage_events`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${context.accessToken}`,
      "Content-Type": "application/json",
      "Content-Profile": "moons",
      Prefer: "return=minimal"
    },
    body: JSON.stringify(event)
  });
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(
      `AI usage persistence failed: ${response.status}${detail ? ` — ${detail}` : ""}`
    );
  }
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

function parseRequestBody(body: BodyInit | null | undefined): unknown {
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return {};
    }
  }
  if (body instanceof FormData) {
    return Object.fromEntries(
      [...body.entries()].flatMap(([key, value]) =>
        typeof value === "string" ? [[key, value]] : []
      )
    );
  }
  return {};
}

function requestUrl(input: URL | RequestInfo): URL | null {
  try {
    return new URL(
      input instanceof Request ? input.url : String(input)
    );
  } catch {
    return null;
  }
}

function readBodyString(value: unknown, key: string): string {
  return isRecord(value) && typeof value[key] === "string"
    ? value[key]
    : "";
}

function readBodyNumber(value: unknown, key: string): number {
  return isRecord(value) && typeof value[key] === "number"
    ? nonNegativeInteger(value[key])
    : 0;
}

function nestedString(value: unknown, path: readonly string[]): string {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return "";
    current = current[key];
  }
  return typeof current === "string" ? current : "";
}

function firstRecord(...values: readonly unknown[]): Record<string, unknown> {
  return values.find(isRecord) ?? {};
}

function firstNumber(...values: readonly unknown[]): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return nonNegativeInteger(value);
    }
  }
  return 0;
}

function firstNullableNumber(...values: readonly unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return null;
}

function nonNegativeInteger(value: number): number {
  return Math.max(0, Math.trunc(value));
}

function countWebSearchRequests(payload: unknown): number {
  let calls = 0;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;
    if (value.type === "web_search_call") calls += 1;
    Object.values(value).forEach(visit);
  };
  visit(payload);

  const usage = isRecord(payload) && isRecord(payload.usage) ? payload.usage : {};
  const legacy = isRecord(usage.server_tool_use)
    ? firstNumber(usage.server_tool_use.web_search_requests)
    : 0;
  const details = isRecord(usage.server_tool_use_details)
    ? firstNumber(usage.server_tool_use_details.web_search_requests)
    : 0;
  return Math.max(calls, legacy, details);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
