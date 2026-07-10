import { describe, expect, it, vi } from "vitest";
import { handleSuggestLearningRequest } from "./suggest-learning-endpoint";

const requestBody = {
  runId: "run-1",
  brand: {
    id: "flora",
    name: "Flora Daily",
    category: "Flowers / lifestyle"
  },
  service: "single-static",
  brief: "Launch a soft summer bouquet offer.",
  creatives: [
    {
      hook: "Flowers that make the room feel softer",
      concept: "Lead with room mood.",
      visual: "Soft natural light with bouquet on table.",
      cta: "Order a bouquet",
      caption: "Fresh flowers for calm homes.",
      graphicDesign: "approved",
      clientService: "approved",
      projectManager: "approved",
      clientStatus: "approved"
    },
    {
      hook: "Buy flowers now",
      concept: "Generic urgency hook.",
      visual: "Stock photo of flowers.",
      cta: "Shop now",
      caption: "Flowers on sale.",
      graphicDesign: "rejected",
      clientService: null,
      projectManager: null,
      clientStatus: "queued"
    }
  ]
};

function buildRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://moons.local/api/suggest-brand-learning", {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody)
  });
}

describe("handleSuggestLearningRequest", () => {
  it("requires a Supabase user token when backend Supabase env is configured", async () => {
    const response = await handleSuggestLearningRequest({
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

  it("returns suggestions grounded in the creative approval signal", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            suggestions: [
              {
                polarity: "working",
                note: "Hooks that describe a calm room mood get approved."
              },
              {
                polarity: "avoid",
                note: "Generic urgency hooks with stock photos get rejected by GD."
              }
            ]
          })
        }),
        { status: 200 }
      )
    );

    const response = await handleSuggestLearningRequest({
      request: buildRequest(),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      suggestions: { polarity: string; note: string }[];
    };
    expect(payload.suggestions).toHaveLength(2);
    expect(payload.suggestions[0]).toMatchObject({ polarity: "working" });
    expect(payload.suggestions[1]).toMatchObject({ polarity: "avoid" });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      input: unknown;
    };
    expect(JSON.stringify(body.input)).toContain(
      "Flowers that make the room feel softer"
    );
    expect(JSON.stringify(body.input)).toContain("GD: rejected");
  });

  it("returns a readable error when OpenAI returns an empty body", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));

    const response = await handleSuggestLearningRequest({
      request: buildRequest(),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "OpenAI brand learning suggestion returned an empty response body."
    });
  });
});
