import { describe, expect, it, vi } from "vitest";
import { handleQualityCheckRequest } from "./quality-check-endpoint";

const requestBody = {
  runId: "run-1",
  brief: "Launch a soft summer bouquet offer.",
  outputs: [
    {
      id: "output-1",
      hook: "Flowers that make the room feel softer",
      concept: "Lead with room mood.",
      visual: "Soft natural light with bouquet on table.",
      assetUrl: "https://example.supabase.co/storage/v1/object/sign/creative-assets/output-1.png"
    }
  ]
};

function buildRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://moons.local/api/quality-check", {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody)
  });
}

describe("handleQualityCheckRequest", () => {
  it("requires a Supabase user token when backend Supabase env is configured", async () => {
    const response = await handleQualityCheckRequest({
      request: buildRequest(),
      env: {
        OPENAI_API_KEY: "test-key",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: vi.fn() as unknown as typeof fetch
    });

    expect(response.status).toBe(401);
  });

  it("sends each image inline to the vision model and returns per-output results", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              results: [
                { outputId: "output-1", passed: false, reason: "Text in the image is garbled." }
              ]
            })
          }),
          { status: 200 }
        )
    );

    const response = await handleQualityCheckRequest({
      request: buildRequest(),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      results: { outputId: string; passed: boolean; reason: string }[];
    };
    expect(payload.results).toEqual([
      { outputId: "output-1", passed: false, reason: "Text in the image is garbled." }
    ]);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      input: { content: { type: string; image_url?: string }[] }[];
    };
    const imageBlock = body.input[0]?.content.find(
      (block) => block.type === "input_image"
    );
    expect(imageBlock?.image_url).toBe(requestBody.outputs[0]?.assetUrl);
  });

  it("returns no results without calling OpenAI when there are no outputs", async () => {
    const fetchMock = vi.fn();

    const response = await handleQualityCheckRequest({
      request: new Request("https://moons.local/api/quality-check", {
        method: "POST",
        body: JSON.stringify({ runId: "run-1", brief: "test", outputs: [] })
      }),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, results: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
