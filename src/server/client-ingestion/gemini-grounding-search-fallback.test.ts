import { describe, expect, it, vi } from "vitest";
import {
  extractGeminiGroundingOutput,
  GeminiGroundingSearchFallback
} from "./gemini-grounding-search-fallback";

const geminiPayload = {
  steps: [
    {
      type: "google_search_call",
      arguments: {
        queries: ["Flora Daily flower brand"]
      }
    },
    {
      type: "model_output",
      content: [
        {
          type: "text",
          text: "Flora Daily sells fresh flower arrangements.",
          annotations: [
            {
              type: "url_citation",
              title: "Flora Daily",
              url: "https://example.com/flora",
              start_index: 0,
              end_index: 11
            }
          ]
        }
      ]
    }
  ]
};

describe("GeminiGroundingSearchFallback", () => {
  it("calls Gemini Interactions API with google_search and returns grounded citations", async () => {
    const fetchMock = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
        new Response(JSON.stringify(geminiPayload), { status: 200 })
    );
    const fallback = new GeminiGroundingSearchFallback({
      apiKey: "gemini-key",
      model: "gemini-test",
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    const result = await fallback.search({
      clientName: "Flora Daily",
      facebookUrl: "https://www.facebook.com/flora"
    });

    expect(result).toMatchObject({
      provider: "gemini",
      model: "gemini-test",
      outputText: "Flora Daily sells fresh flower arrangements.",
      searchQueries: ["Flora Daily flower brand"],
      citations: [
        {
          title: "Flora Daily",
          url: "https://example.com/flora"
        }
      ]
    });

    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) throw new Error("fetch was not called.");
    const [, requestInit] = firstCall;
    const body = JSON.parse(String((requestInit as RequestInit).body)) as {
      model: string;
      tools: { type: string }[];
      input: string;
    };

    expect(firstCall[0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/interactions"
    );
    expect(body.model).toBe("gemini-test");
    expect(body.tools).toEqual([{ type: "google_search" }]);
    expect(body.input).toContain("Flora Daily");
  });

  it("extracts output text, search queries, and citations from raw Gemini steps", () => {
    expect(extractGeminiGroundingOutput(geminiPayload)).toEqual({
      outputText: "Flora Daily sells fresh flower arrangements.",
      searchQueries: ["Flora Daily flower brand"],
      citations: [
        {
          title: "Flora Daily",
          url: "https://example.com/flora"
        }
      ]
    });
  });
});
