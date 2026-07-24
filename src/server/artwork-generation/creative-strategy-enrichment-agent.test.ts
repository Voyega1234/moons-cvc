import { describe, expect, it, vi } from "vitest";
import {
  buildCreativeStrategyEvidence,
  enrichCreativeStrategy
} from "./creative-strategy-enrichment-agent";

const input = {
  brand: {
    name: "Flora Daily",
    category: "Flowers / lifestyle",
    personality: ["fresh", "soft"],
    colors: ["#F6B8C8", "#FFFFFF"]
  },
  service: "single-static",
  brief: "Launch with a 20% launch discount for Bangkok customers.",
  hook: {
    hook: "Flowers that make the room feel softer",
    concept: "Lead with room mood.",
    why: "Connects the offer to a clear room mood.",
    visual: "A bouquet changing the feeling of a lived-in room.",
    cta: "Order a bouquet",
    supportingPoints: ["Same-day delivery in Bangkok"],
    caption: "Fresh flowers for calm homes."
  },
  brandMemory: {
    working: ["Warm lifestyle scenes are consistently approved."],
    avoid: ["Avoid hard-sell red graphics."]
  },
  brandLibrary: {
    brand: [
      {
        title: "Positioning",
        description: "Seasonal bouquets arranged by local florists"
      }
    ],
    products: [
      {
        title: "Soft Summer Bouquet",
        description: "Hand-arranged seasonal stems"
      }
    ],
    docs: [],
    refs: [{ title: "Past campaign", description: "Warm editorial photography" }]
  }
};

function strategy(overrides: Record<string, unknown> = {}) {
  return {
    commercialStyle: "promotion",
    sellingMechanism: "offer",
    preferredMode: "standard_commercial",
    preferredLayout: "lifestyle_commercial",
    preferredHeroType: "product_packshot",
    humanPresence: "avoid",
    audienceMoment: "A Bangkok customer wants the room to feel softer today.",
    reasonToBelieve: "The offer removes friction while the bouquet proves the mood change.",
    visibleProofDirection: "Show the bouquet transforming a real lived-in room.",
    offer: {
      text: "20% launch discount",
      evidenceId: "brief:0",
      source: "verified"
    },
    proof: [
      {
        text: "Same-day delivery in Bangkok",
        evidenceId: "supporting-point:0",
        source: "verified"
      }
    ],
    differentiator: {
      text: "Hand-arranged seasonal stems",
      evidenceId: "product:0",
      source: "verified"
    },
    referenceSearchText:
      "warm lifestyle commercial editorial bouquet offer product hero",
    evidenceStatus: "verified",
    requiresTextReview: false,
    missingEvidence: [],
    ...overrides
  };
}

describe("enrichCreativeStrategy", () => {
  it("uses GPT Luna and returns a grounded style-first strategy", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const traces: unknown[] = [];
    const fetchMock = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({
          url: String(url),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>
        });
        return new Response(
          JSON.stringify({ output_text: JSON.stringify(strategy()) }),
          { status: 200 }
        );
      }
    );

    const result = await enrichCreativeStrategy({
      apiKey: "secret-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
      input,
      loadPrompt: async () => "CREATIVE STRATEGY ENRICHMENT",
      writeTrace: async (trace) => {
        traces.push(trace);
      }
    });

    expect(result).toMatchObject({
      commercialStyle: "promotion",
      sellingMechanism: "offer",
      preferredLayout: "lifestyle_commercial",
      humanPresence: "avoid",
      offer: {
        text: "20% launch discount",
        evidenceId: "brief:0",
        source: "verified"
      }
    });
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/responses");
    expect(calls[0]?.body).toMatchObject({
      model: "gpt-5.6-luna",
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "moons_creative_strategy_enrichment",
          strict: true
        }
      }
    });
    const promptText = (
      calls[0]?.body.input as { content: { text: string }[] }[]
    )[0]?.content[0]?.text;
    expect(promptText).toContain("CREATIVE STRATEGY ENRICHMENT");
    expect(promptText).toContain(
      '"brief": "Launch with a 20% launch discount for Bangkok customers."'
    );
    expect(promptText).toContain('"id": "brief:0"');
    expect(promptText).toContain('"allowedUses": [');
    expect(promptText).toContain("Warm lifestyle scenes are consistently approved.");
    expect(traces).toEqual([
      expect.objectContaining({
        model: "gpt-5.6-luna",
        status: "succeeded",
        response: expect.objectContaining({ commercialStyle: "promotion" })
      })
    ]);
    expect(JSON.stringify(traces)).not.toContain("secret-key");
  });

  it("rejects factual text that is not a verbatim excerpt of cited evidence", async () => {
    const traces: unknown[] = [];
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify(
            strategy({
              proof: [
                {
                  text: "Delivered in 30 minutes",
                  evidenceId: "supporting-point:0",
                  source: "verified"
                }
              ]
            })
          )
        }),
        { status: 200 }
      )
    );

    await expect(
      enrichCreativeStrategy({
        apiKey: "test-key",
        fetchImpl: fetchMock as unknown as typeof fetch,
        input,
        loadPrompt: async () => "PROMPT",
        writeTrace: async (trace) => {
          traces.push(trace);
        }
      })
    ).rejects.toThrow("proof text is not a verbatim excerpt");
    expect(traces).toEqual([
      expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("not a verbatim excerpt")
      })
    ]);
  });

  it("allows invented layout-completing copy when it is marked for review", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify(
            strategy({
              offer: {
                text: "เปิดตัว 1–15 สิงหาคม ลด 20%",
                evidenceId: "",
                source: "creative-placeholder"
              },
              proof: [],
              differentiator: { text: "", evidenceId: "", source: "none" },
              evidenceStatus: "placeholder",
              requiresTextReview: true,
              missingEvidence: ["final campaign dates and discount"]
            })
          )
        }),
        { status: 200 }
      )
    );

    const result = await enrichCreativeStrategy({
      apiKey: "test-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
      input,
      loadPrompt: async () => "PROMPT"
    });

    expect(result.offer).toEqual({
      text: "เปิดตัว 1–15 สิงหาคม ลด 20%",
      evidenceId: "",
      source: "creative-placeholder"
    });
    expect(result.requiresTextReview).toBe(true);
  });

  it("retries once when a source-none claim is not empty", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const traces: unknown[] = [];
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        calls.push(
          JSON.parse(String(init?.body)) as Record<string, unknown>
        );
        const differentiator =
          calls.length === 1
            ? {
                text: "Hand-arranged seasonal stems",
                evidenceId: "",
                source: "none"
              }
            : { text: "", evidenceId: "", source: "none" };
        return new Response(
          JSON.stringify({
            output_text: JSON.stringify(
              strategy({
                differentiator,
                evidenceStatus: "mixed",
                missingEvidence: ["verified differentiator"]
              })
            )
          }),
          { status: 200 }
        );
      }
    );

    const result = await enrichCreativeStrategy({
      apiKey: "test-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
      input,
      loadPrompt: async () => "PROMPT",
      writeTrace: async (trace) => {
        traces.push(trace);
      }
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryPrompt = (
      calls[1]?.input as { content: { text: string }[] }[]
    )[0]?.content[0]?.text;
    expect(retryPrompt).toContain(
      "differentiator with source none must be empty."
    );
    expect(retryPrompt).toContain(
      'When any claim uses source "none", both text and evidenceId must be empty strings.'
    );
    expect(result.differentiator).toEqual({
      text: "",
      evidenceId: "",
      source: "none"
    });
    expect(traces).toEqual([
      expect.objectContaining({
        status: "succeeded",
        response: expect.objectContaining({
          differentiator: { text: "", evidenceId: "", source: "none" }
        })
      })
    ]);
  });

  it("builds evidence separately from creative-preference memory and style references", () => {
    const evidence = buildCreativeStrategyEvidence(input);

    expect(evidence.map((item) => item.id)).toEqual([
      "brief:0",
      "supporting-point:0",
      "brand:0",
      "product:0"
    ]);
    expect(JSON.stringify(evidence)).not.toContain("consistently approved");
    expect(JSON.stringify(evidence)).not.toContain("Past campaign");
  });
});
