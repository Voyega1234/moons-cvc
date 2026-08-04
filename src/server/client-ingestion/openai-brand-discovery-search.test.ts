import { describe, expect, it, vi } from "vitest";
import {
  extractOpenAiBrandDiscoveryOutput,
  OpenAiBrandDiscoverySearch
} from "./openai-brand-discovery-search";

describe("OpenAiBrandDiscoverySearch", () => {
  it("uses Terra web search with Thailand localization and returns grounded text and citations", async () => {
    const payload = {
      output: [
        {
          type: "web_search_call",
          action: {
            type: "search",
            sources: [
              { title: "Official store", url: "https://siambloom.co.th" }
            ]
          }
        },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "Siam Bloom sells flower gifts in Thailand.",
              annotations: [
                {
                  type: "url_citation",
                  title: "Thai profile",
                  url: "https://example.co.th/siam-bloom"
                }
              ]
            }
          ]
        }
      ]
    };
    const fetchMock = vi.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        _init?: Parameters<typeof fetch>[1]
      ) => new Response(JSON.stringify(payload), { status: 200 })
    );
    const search = new OpenAiBrandDiscoverySearch({
      apiKey: "test-key",
      model: "gpt-5.6-terra",
      fetchImpl: fetchMock as unknown as typeof fetch,
      retryDelayMs: 0
    });

    const result = await search.search({
      clientName: "Siam Bloom",
      facebookUrl: "",
      questionnaireText: "Product: flower delivery in Bangkok."
    });

    const request = fetchMock.mock.calls[0];
    if (!request) throw new Error("fetch was not called.");
    const body = JSON.parse(String(request[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "gpt-5.6-terra",
      store: false,
      tool_choice: "required",
      include: ["web_search_call.action.sources"]
    });
    expect(body.tools).toEqual([
      expect.objectContaining({
        type: "web_search",
        search_context_size: "medium",
        user_location: {
          type: "approximate",
          country: "TH",
          city: "Bangkok",
          region: "Bangkok",
          timezone: "Asia/Bangkok"
        }
      })
    ]);
    expect(String(body.input)).toContain("Siam Bloom");
    expect(String(body.input)).toContain("Thailand");
    expect(String(body.input)).toContain("flower delivery in Bangkok");
    expect(result.outputText).toContain("flower gifts in Thailand");
    expect(result.citations).toEqual([
      { title: "Official store", url: "https://siambloom.co.th" },
      { title: "Thai profile", url: "https://example.co.th/siam-bloom" }
    ]);
  });

  it("extracts output_text when it is available at the response root", () => {
    expect(
      extractOpenAiBrandDiscoveryOutput({
        output_text: "Grounded brand summary",
        output: []
      })
    ).toEqual({ outputText: "Grounded brand summary", citations: [] });
  });

  it("includes upstream error details and request id", async () => {
    const search = new OpenAiBrandDiscoverySearch({
      apiKey: "test-key",
      fetchImpl: vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: { code: "invalid_request", message: "Web search failed." }
          }),
          { status: 400, headers: { "x-request-id": "req-search-1" } }
        )
      ) as unknown as typeof fetch,
      retryDelayMs: 0
    });

    await expect(
      search.search({ clientName: "Siam Bloom", facebookUrl: "" })
    ).rejects.toThrow(
      "OpenAI brand discovery failed (400, request req-search-1): invalid_request — Web search failed."
    );
  });
});
