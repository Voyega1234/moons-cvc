import { describe, expect, it, vi } from "vitest";
import { generateImagePrompt } from "./image-prompt-agent";

const baseInput = {
  brand: {
    name: "Flora Daily",
    category: "Flowers / lifestyle",
    personality: ["fresh", "soft"],
    colors: ["#F6B8C8", "#FFFFFF"]
  },
  service: "single-static",
  brief: "Launch a soft summer bouquet offer.",
  hook: {
    hook: "Flowers that make the room feel softer",
    concept: "Lead with room mood.",
    why: "Connects the offer to a clear room mood.",
    visual: "Photographic editorial bouquet scene with tactile grain.",
    cta: "Order a bouquet",
    caption: "Fresh flowers for calm homes."
  },
  textInputs: [],
  referenceImageLabels: [],
  referenceImages: [],
  canvasRatio: "1:1",
  brandLibrary: { brand: [], products: [], docs: [], refs: [] }
};

describe("generateImagePrompt", () => {
  it("sends the brief to the Responses API and returns the agent's prompt", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>
      });
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            finalPrompt: "Final production-ready prompt."
          })
        }),
        { status: 200 }
      );
    });

    const result = await generateImagePrompt({
      apiKey: "test-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
      input: baseInput
    });

    expect(result).toBe("Final production-ready prompt.");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/responses");
    expect(calls[0]?.body.model).toBe("gpt-5.6-terra");
    expect(calls[0]?.body.text).toMatchObject({
      format: {
        schema: {
          required: ["finalPrompt"]
        }
      }
    });
    const promptText = (
      calls[0]?.body.input as { content: { text: string }[] }[]
    )[0]?.content[0]?.text;
    expect(promptText).toContain(
      '"headline": "Flowers that make the room feel softer"'
    );
    expect(promptText).toContain("AUTHORITATIVE COMPACT CAMPAIGN INPUT");
    expect(promptText).toContain('"personality": [');
    expect(promptText).toContain('"colors": [');
    expect(promptText).not.toContain('"mustAvoid"');
    expect(promptText).not.toContain('"onImageCopy"');
    expect(promptText).not.toContain('"heroVisual"');
    expect(promptText).not.toContain('"visualDirection"');
    expect(promptText).not.toContain('"maximumTextBlocks"');
    expect(promptText).not.toContain('"copyDensity"');
    expect(promptText).not.toContain('"compositionDensity"');
    expect(promptText).not.toContain('"visualFreedom"');
    expect(promptText).not.toContain('"mustShow"');
    expect(promptText).not.toContain('"mustNotShow"');
    expect(promptText).not.toContain(
      "Create one production-ready English GPT Image 2 prompt from this compact creative input."
    );
    expect(promptText).not.toContain("Fresh flowers for calm homes.");
  });

  it("sends useful supporting details without prescribing on-image copy", async () => {
    const calls: { body: Record<string, unknown> }[] = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        body: JSON.parse(String(init?.body)) as Record<string, unknown>
      });
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({ finalPrompt: "Prompt with support." })
        }),
        { status: 200 }
      );
    });

    await generateImagePrompt({
      apiKey: "test-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
      input: {
        ...baseInput,
        hook: {
          ...baseInput.hook,
          supportingPoints: [
            "Same-day delivery in Bangkok",
            "Seasonal stems selected daily"
          ]
        }
      }
    });

    const promptText = (
      calls[0]?.body.input as { content: { text: string }[] }[]
    )[0]?.content[0]?.text;
    expect(promptText).toContain('"supportingDetails": [');
    expect(promptText).toContain("Same-day delivery in Bangkok");
    expect(promptText).toContain("Seasonal stems selected daily");
    expect(promptText).not.toContain('"onImageCopy"');
    expect(promptText).not.toContain('"heroVisual"');
    expect(promptText).not.toContain('"visualDirection"');
  });

  it("describes the three-panel master grid for Standard album posts", async () => {
    const calls: { body: Record<string, unknown> }[] = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        body: JSON.parse(String(init?.body)) as Record<string, unknown>
      });
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({ finalPrompt: "Album master prompt." })
        }),
        { status: 200 }
      );
    });

    await generateImagePrompt({
      apiKey: "test-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
      input: {
        ...baseInput,
        service: "album-post",
        hook: {
          ...baseInput.hook,
          formatBeats: ["Hook", "Proof", "Offer"]
        }
      }
    });

    const promptText = (
      calls[0]?.body.input as { content: { text: string }[] }[]
    )[0]?.content[0]?.text;
    expect(promptText).toContain('"albumMaster"');
    expect(promptText).toContain(
      '"grid": "one 2:1 cover across the top; two 1:1 panels below"'
    );
    expect(promptText).toContain('"panel2": "Proof"');
    expect(promptText).toContain(
      '"cropSafety": "each panel self-contained; no essential element crosses a seam"'
    );
  });

  it("writes a sanitized trace with the exact agent input and returned prompt", async () => {
    const traces: unknown[] = [];
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            finalPrompt: "Final production-ready prompt."
          })
        }),
        { status: 200 }
      )
    );

    await generateImagePrompt({
      apiKey: "secret-test-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
      input: {
        ...baseInput,
        referenceImages: [
          {
            label: "Brand campaign",
            imageUrl: "data:image/png;base64,c2Vuc2l0aXZlLWltYWdl"
          }
        ]
      },
      writeTrace: async (trace) => {
        traces.push(trace);
      }
    });

    expect(traces).toEqual([
      expect.objectContaining({
        model: "gpt-5.6-terra",
        mode: "standard",
        status: "succeeded",
        inputText: expect.stringContaining(
          '"headline": "Flowers that make the room feel softer"'
        ),
        responsePrompt: "Final production-ready prompt."
      })
    ]);
    expect(JSON.stringify(traces)).not.toContain("secret-test-key");
    expect(JSON.stringify(traces)).not.toContain("c2Vuc2l0aXZlLWltYWdl");
  });

  it("attaches selected reference images so the prompt agent can inspect their visual style", async () => {
    const calls: { body: Record<string, unknown> }[] = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(
        JSON.stringify({ output_text: JSON.stringify({ prompt: "Prompt." }) }),
        { status: 200 }
      );
    });

    await generateImagePrompt({
      apiKey: "test-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
      input: {
        ...baseInput,
        referenceImageLabels: ["Past work style reference — Luxury campaign"],
        referenceImages: [
          {
            label: "Past work style reference — Luxury campaign",
            imageUrl: "data:image/png;base64,cmVmZXJlbmNl"
          }
        ]
      }
    });

    const content = (calls[0]?.body.input as {
      content: { type: string; image_url?: string; text?: string }[];
    }[])[0]?.content;
    expect(content).toContainEqual({
      type: "input_image",
      image_url: "data:image/png;base64,cmVmZXJlbmNl",
      detail: "high"
    });
    expect(content?.[0]?.text).toContain(
      '"id": "past-work-style-reference-luxury-campaign"'
    );
    expect(content?.[0]?.text).toContain('"role": "brand-visual-dna"');
    expect(content?.[0]?.text).toContain('"fidelity": "style-only"');
    expect(content?.[0]?.text).not.toContain("STYLE SELECTION:");
  });

  it("keeps design-system mode out of the image prompt agent", async () => {
    const fetchMock = vi.fn();

    await expect(
      generateImagePrompt({
        apiKey: "test-key",
        mode: "design-system",
        fetchImpl: fetchMock as unknown as typeof fetch,
        input: baseInput
      })
    ).rejects.toThrow(
      "Design-system mode sends its thin brief and artifacts directly to GPT Image 2."
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses a compact two-reference contract in reference-library mode", async () => {
    const calls: { body: Record<string, unknown> }[] = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            finalPrompt: "Reference-informed production prompt."
          })
        }),
        { status: 200 }
      );
    });

    const result = await generateImagePrompt({
      apiKey: "test-key",
      mode: "reference-library",
      fetchImpl: fetchMock as unknown as typeof fetch,
      input: {
        ...baseInput,
        referenceImages: [
          {
            label: "Logo",
            imageUrl: "data:image/png;base64,bG9nbw=="
          },
          {
            label: "Past work style reference — Premium launch",
            imageUrl: "https://example.com/past-work.jpg"
          },
          {
            label: "Moons artwork reference — primary",
            imageUrl: "https://example.com/primary.jpg"
          },
          {
            label: "Moons artwork reference — secondary",
            imageUrl: "https://example.com/secondary.jpg"
          }
        ],
        brandLibrary: {
          brand: [],
          products: [],
          docs: [],
          refs: [
            {
              title: "Source: brand_analysis_jobs/hidden",
              description: "Long audience analysis must stay upstream."
            }
          ]
        }
      },
      loadReferenceLibraryPrompt: async () =>
        "REFERENCE ART DIRECTOR\nStudy the actual attached images."
    });

    expect(result).toBe("Reference-informed production prompt.");
    const promptText = (
      calls[0]?.body.input as { content: { text: string }[] }[]
    )[0]?.content[0]?.text;
    expect(promptText).toContain("REFERENCE ART DIRECTOR");
    expect(promptText).toContain(
      "RUNTIME EXECUTION CONTRACT — REFERENCE-LIBRARY MODE"
    );
    expect(promptText).toContain(
      "Primary artwork contributes abstract composition grammar"
    );
    expect(promptText).toContain(
      "Invent all message-bearing visual content and the background from the approved idea"
    );
    expect(promptText).toContain('"headline": "Flowers that make the room feel softer"');
    expect(promptText).toContain('"visualDirection": "Photographic editorial bouquet scene with tactile grain."');
    expect(promptText).toContain('"role": "official logo — exact"');
    expect(promptText).toContain(
      '"role": "approved past work — infer brand visual DNA only; do not copy its content"'
    );
    expect(promptText).toContain(
      '"role": "primary artwork — composition and visual medium"'
    );
    expect(promptText).toContain(
      '"role": "secondary artwork — compatible craft and finish"'
    );
    expect(promptText).not.toContain("brand_analysis_jobs/hidden");
    expect(promptText).not.toContain("Long audience analysis must stay upstream.");
    expect(calls[0]?.body.text).toMatchObject({
      format: {
        schema: {
          required: ["finalPrompt"]
        }
      }
    });
  });

  it("keeps regeneration instructions as one optional compact field", async () => {
    const calls: { body: Record<string, unknown> }[] = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(
        JSON.stringify({ output_text: JSON.stringify({ prompt: "Prompt." }) }),
        { status: 200 }
      );
    });

    await generateImagePrompt({
      apiKey: "test-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
      input: {
        ...baseInput,
        textInputs: ["Keep the same concept but use a warmer tone."]
      }
    });

    const promptText = (
      calls[0]?.body.input as { content: { text: string }[] }[]
    )[0]?.content[0]?.text;
    expect(promptText).toContain('"revisionInstructions": [');
    expect(promptText).toContain(
      '"Keep the same concept but use a warmer tone."'
    );
  });

  it("uses the provided model override", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({ prompt: "Prompt." })
        }),
        { status: 200 }
      )
    );

    await generateImagePrompt({
      apiKey: "test-key",
      model: "gpt-5.6-terra",
      fetchImpl: fetchMock as unknown as typeof fetch,
      input: baseInput
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { model: string };
    expect(body.model).toBe("gpt-5.6-terra");
  });

  it("routes Claude Sonnet 4.6 through the OpenRouter Responses API", async () => {
    const calls: Array<{ url: string; authorization: string | null }> = [];
    const fetchMock = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        calls.push({
          url: String(url),
          authorization: headers.get("Authorization")
        });
        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({ finalPrompt: "OpenRouter prompt." })
          }),
          { status: 200 }
        );
      }
    );
    const traces: unknown[] = [];

    const result = await generateImagePrompt({
      apiKey: "openrouter-key",
      model: "anthropic/claude-sonnet-4.6",
      provider: "openrouter",
      fetchImpl: fetchMock as unknown as typeof fetch,
      input: baseInput,
      writeTrace: async (trace) => {
        traces.push(trace);
      }
    });

    expect(result).toBe("OpenRouter prompt.");
    expect(calls).toEqual([
      {
        url: "https://openrouter.ai/api/v1/responses",
        authorization: "Bearer openrouter-key"
      }
    ]);
    expect(traces).toEqual([
      expect.objectContaining({
        provider: "openrouter",
        endpoint: "/api/v1/responses",
        model: "anthropic/claude-sonnet-4.6",
        status: "succeeded"
      })
    ]);
  });

  it("throws when the API call fails", async () => {
    const traces: unknown[] = [];
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { message: "Provider account has no credits." } }),
        { status: 402 }
      )
    );

    await expect(
      generateImagePrompt({
        apiKey: "test-key",
        fetchImpl: fetchMock as unknown as typeof fetch,
        input: baseInput,
        writeTrace: async (trace) => {
          traces.push(trace);
        }
      })
    ).rejects.toThrow(
      "OpenAI image prompt agent failed: 402 — Provider account has no credits."
    );
    expect(traces).toEqual([
      expect.objectContaining({
        status: "failed",
        inputText: expect.stringContaining(
          '"headline": "Flowers that make the room feel softer"'
        ),
        error:
          "OpenAI image prompt agent failed: 402 — Provider account has no credits."
      })
    ]);
  });

  it("throws when the response has no prompt text", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ output_text: JSON.stringify({ finalPrompt: "" }) }),
        { status: 200 }
      )
    );

    await expect(
      generateImagePrompt({
        apiKey: "test-key",
        fetchImpl: fetchMock as unknown as typeof fetch,
        input: baseInput
      })
    ).rejects.toThrow("OpenAI image prompt agent returned an empty prompt.");
  });
});
