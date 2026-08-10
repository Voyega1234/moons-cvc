import { describe, expect, it, vi } from "vitest";
import { createAiUsageTrackingFetch } from "./ai-usage-recorder";

const context = {
  supabaseUrl: "https://example.supabase.co",
  supabaseAnonKey: "anon-key",
  accessToken: "user-token",
  ownerUserId: "user-1",
  clientId: "client-1",
  workspaceRunId: "run-1",
  operation: "hook-generation" as const
};

describe("createAiUsageTrackingFetch", () => {
  it("persists normalized OpenAI text and search usage without prompts", async () => {
    let stored: Record<string, unknown> | null = null;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes("/rest/v1/ai_usage_events")) {
        stored = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(null, { status: 201 });
      }
      return jsonResponse(
        {
          id: "resp_123",
          model: "gpt-5.6-terra",
          output: [{ type: "web_search_call" }],
          usage: {
            input_tokens: 1_200,
            input_tokens_details: {
              cached_tokens: 300,
              cache_write_tokens: 200
            },
            output_tokens: 450,
            output_tokens_details: { reasoning_tokens: 100 },
            total_tokens: 1_650
          }
        },
        { headers: { "x-request-id": "req_123" } }
      );
    });
    const trackedFetch = createAiUsageTrackingFetch({ fetchImpl, context });

    const response = await trackedFetch("https://api.openai.com/v1/responses", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.6-terra",
        input: [{ role: "user", content: "secret prompt" }],
        text: {
          format: { type: "json_schema", name: "moons_hook_research" }
        }
      })
    });

    expect(response.status).toBe(200);
    expect(stored).toMatchObject({
      owner_user_id: "user-1",
      client_id: "client-1",
      workspace_run_id: "run-1",
      operation: "hook-generation",
      stage: "moons_hook_research",
      modality: "text",
      provider: "openai",
      model: "gpt-5.6-terra",
      endpoint: "/v1/responses",
      provider_request_id: "req_123",
      status: "succeeded",
      input_tokens: 1_200,
      cached_input_tokens: 300,
      cache_write_tokens: 200,
      output_tokens: 450,
      reasoning_tokens: 100,
      total_tokens: 1_650,
      web_search_requests: 1,
      raw_usage: expect.any(Object)
    });
    expect(JSON.stringify(stored)).not.toContain("secret prompt");
  });

  it("persists image token details plus size, quality, and image count", async () => {
    let stored: Record<string, unknown> | null = null;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).includes("/rest/v1/ai_usage_events")) {
        stored = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(null, { status: 201 });
      }
      return jsonResponse({
        data: [{ b64_json: "image-data" }],
        usage: {
          input_tokens: 900,
          input_tokens_details: { text_tokens: 200, image_tokens: 700 },
          output_tokens: 4_000,
          output_tokens_details: { image_tokens: 4_000 },
          total_tokens: 4_900
        }
      });
    });
    const trackedFetch = createAiUsageTrackingFetch({
      fetchImpl,
      context: { ...context, operation: "artwork-generation" }
    });

    await trackedFetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-image-2",
        prompt: "secret image prompt",
        n: 1,
        size: "1024x1536",
        quality: "medium"
      })
    });

    expect(stored).toMatchObject({
      operation: "artwork-generation",
      stage: "image-generation",
      modality: "image",
      model: "gpt-image-2",
      input_tokens: 900,
      input_text_tokens: 200,
      input_image_tokens: 700,
      output_tokens: 4_000,
      output_image_tokens: 4_000,
      image_count: 1,
      image_size: "1024x1536",
      image_quality: "medium"
    });
    expect(JSON.stringify(stored)).not.toContain("secret image prompt");
  });

  it("records failed provider attempts so retries remain countable", async () => {
    let stored: Record<string, unknown> | null = null;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).includes("/rest/v1/ai_usage_events")) {
        stored = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(null, { status: 201 });
      }
      return jsonResponse(
        { error: { message: "temporary failure" } },
        { status: 503 }
      );
    });
    const trackedFetch = createAiUsageTrackingFetch({ fetchImpl, context });

    const response = await trackedFetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        body: JSON.stringify({ model: "anthropic/claude-sonnet-4.6" })
      }
    );

    expect(response.status).toBe(503);
    expect(stored).toMatchObject({
      provider: "openrouter",
      status: "failed",
      http_status: 503,
      input_tokens: 0,
      output_tokens: 0
    });
  });

  it("does not attempt persistence when there is no authenticated identity", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ usage: {} }));
    const trackedFetch = createAiUsageTrackingFetch({
      fetchImpl,
      context: {
        ...context,
        accessToken: null,
        ownerUserId: null
      }
    });

    await trackedFetch("https://api.openai.com/v1/responses", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-5.6-terra" })
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("records transport failures before rethrowing them", async () => {
    let stored: Record<string, unknown> | null = null;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).includes("/rest/v1/ai_usage_events")) {
        stored = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(null, { status: 201 });
      }
      throw new Error("headers timeout");
    });
    const trackedFetch = createAiUsageTrackingFetch({ fetchImpl, context });

    await expect(
      trackedFetch("https://api.openai.com/v1/responses", {
        method: "POST",
        body: JSON.stringify({ model: "gpt-5.6-terra" })
      })
    ).rejects.toThrow("headers timeout");
    expect(stored).toMatchObject({
      status: "failed",
      http_status: 0,
      input_tokens: 0,
      output_tokens: 0
    });
  });
});

function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...Object.fromEntries(new Headers(init?.headers).entries())
    }
  });
}
