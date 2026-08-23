import { describe, expect, it, vi } from "vitest";
import {
  buildStandardImagePrompt,
  generateImagePrompt,
  generateProductionBrief,
  preflightCampaignInput
} from "./image-prompt-agent";

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
  it("uses Terra to clean Campaign Input without receiving agent_image.md or creating a visual route", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchMock = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({
          url: String(url),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>
        });
        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              brand: {
                name: "Flora Daily",
                category: "Flowers / lifestyle",
                colors: ["#F6B8C8", "#FFFFFF"]
              },
              primaryProductOrService: "Summer bouquet",
              objective: "Connect the offer to a clear room mood.",
              targetAudience: "",
              singleMainMessage: "Flowers make the room feel softer.",
              concept: "Lead with room mood.",
              copy: {
                headline: "Flowers that make the room feel softer",
                supportingText: [],
                cta: "Order a bouquet"
              },
              requiredElements: ["Summer bouquet"],
              forbiddenElements: [],
              references: [],
              lockedProductFacts: [],
              excludedInformation: [],
              albumSequence: [],
              userInstructions: [],
              output: { service: "static", ratio: "1:1" }
            })
          }),
          { status: 200 }
        );
      }
    );

    const result = await preflightCampaignInput({
      apiKey: "openai-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
      input: baseInput,
      loadPrompt: async () => "# Campaign Input Preflight\nOrganize facts only."
    });

    expect(result.copy.headline).toBe(
      "Flowers that make the room feel softer"
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/responses");
    expect(calls[0]?.body.model).toBe("gpt-5.6-sol");
    expect(calls[0]?.body.store).toBe(false);
    expect(calls[0]?.body.text).toMatchObject({
      format: {
        name: "moons_campaign_input_preflight",
        strict: true
      }
    });
    const inputText = (
      calls[0]?.body.input as { content: { text: string }[] }[]
    )[0]?.content[0]?.text;
    expect(inputText).toContain("CAMPAIGN INPUT TO PREFLIGHT");
    expect(inputText).toContain(
      '"headline": "Flowers that make the room feel softer"'
    );
    expect(inputText).not.toContain("AD CREATIVE GENERATION PROMPT");
    expect(inputText).not.toContain("Visual Mechanism");
    expect(inputText).not.toContain('"workingBrief"');
    expect(inputText).not.toContain('"personality"');
  });

  it("gives Standard style references visual priority and isolates product materials", async () => {
    const promptText = await buildStandardImagePrompt(
      {
        ...baseInput,
        referenceImageLabels: [
          "Supporting reference · Style · Living room campaign",
          "Uploaded product (preserve its visible identity): lotion.jpg — Lotion"
        ],
        referenceImages: [
          {
            label: "Supporting reference · Style · Living room campaign",
            imageUrl: "data:image/jpeg;base64,c3R5bGU="
          },
          {
            label:
              "Uploaded product (preserve its visible identity): lotion.jpg — Lotion",
            imageUrl: "data:image/jpeg;base64,cHJvZHVjdA=="
          }
        ]
      },
      async () => "STANDARD IMAGE PROMPT"
    );

    expect(promptText).toContain('"image": 1');
    expect(promptText).toContain(
      '"role": "primary-style-and-composition-reference"'
    );
    expect(promptText).toContain("strongest source of visual direction");
    expect(promptText).toContain("not as a blanket lock");
    expect(promptText).toContain(
      "do not reduce the reference to palette or mood alone"
    );
    expect(promptText).toContain('"image": 2');
    expect(promptText).toContain('"role": "product-identity-only"');
    expect(promptText).toContain(
      "Preserve exactly only the product itself"
    );
    expect(promptText).toContain(
      "Do not use this image as a reference for camera angle"
    );
    expect(promptText).not.toContain('"fidelity"');
    expect(promptText).not.toContain("input_fidelity");
  });

  it("sends the compact Standard input and returns the agent's prompt", async () => {
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
      input: {
        ...baseInput,
        hook: { ...baseInput.hook, why: "" }
      }
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
    expect(promptText).toContain('"objective": "Lead with room mood."');
    expect(promptText).toContain("AUTHORITATIVE PREFLIGHTED CAMPAIGN INPUT");
    expect(promptText).toContain('"colors": [');
    expect(promptText).not.toContain("WORKING BRIEF PRIORITY");
    expect(promptText).not.toContain('"workingBrief"');
    expect(promptText).not.toContain('"personality"');
    expect(promptText).not.toContain(
      "Launch a soft summer bouquet offer."
    );
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

  it.each([
    [
      "three-vertical",
      "portrait cover with hook and main visual",
      '"image3": "Offer"'
    ],
    [
      "three-horizontal",
      "landscape cover with hook and main visual",
      '"image3": "Offer"'
    ],
    [
      "four-vertical",
      "portrait cover with hook and main visual",
      '"image4": "Offer"'
    ],
    [
      "four-grid",
      "square cover with hook and main visual",
      '"image4": "Offer"'
    ]
  ] as const)(
    "describes the %s master-artboard sequence for Standard album posts",
    async (albumFormat, firstImage, finalImage) => {
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
        albumFormat,
        hook: {
          ...baseInput.hook,
          formatBeats: ["Hook", "Proof", "Offer"]
        }
      }
    });

    const promptText = (
      calls[0]?.body.input as { content: { text: string }[] }[]
    )[0]?.content[0]?.text;
    expect(promptText).toContain('"albumSequence"');
    expect(promptText).toContain(`"image1": "${firstImage}"`);
    expect(promptText).toContain(finalImage);
    expect(promptText).toContain(
      '"delivery": "one square master artboard using the requested panel layout; the backend will crop it into separate standalone image files"'
    );
    expect(promptText).not.toContain('"albumMaster"');
    }
  );

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
        referenceImageLabels: [
          "Primary reference · Style · Product packshot"
        ],
        referenceImages: [
          {
            label: "Primary reference · Style · Product packshot",
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
      '"id": "primary-reference-style-product-packshot"'
    );
    expect(content?.[0]?.text).toContain(
      '"role": "primary-style-and-composition-reference"'
    );
    expect(content?.[0]?.text).not.toContain('"fidelity"');
    expect(content?.[0]?.text).not.toContain("STYLE SELECTION:");
  });

  it("uses the archived V6 concept director in design-system mode", async () => {
    const calls: { body: Record<string, unknown> }[] = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        body: JSON.parse(String(init?.body)) as Record<string, unknown>
      });
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            visualConcept:
              "A single bouquet softens the hard geometry of a room. The transformation makes the campaign benefit visible before the headline completes it. The audience recognizes the emotional lift of a small environmental change."
          })
        }),
        { status: 200 }
      );
    });

    const result = await generateImagePrompt({
      apiKey: "test-key",
      mode: "design-system",
      fetchImpl: fetchMock as unknown as typeof fetch,
      loadCreativeGraphicDesignerPrompt: async () =>
        "V6 CREATIVE CONCEPT DIRECTOR TEST",
      input: {
        ...baseInput,
        brandLibrary: {
          ...baseInput.brandLibrary,
          docs: [
            {
              title: "Brand guideline",
              description:
                "Use warm daylight, editorial photography, and restrained typography."
            }
          ]
        },
        referenceImages: [
          {
            label:
              "Supporting reference · Style · Past work style reference — Summer campaign",
            imageUrl: "data:image/png;base64,cmVmZXJlbmNl"
          }
        ]
      }
    });

    expect(result).toContain("A single bouquet softens");
    expect(result).not.toContain("Brand:\nFlora Daily");
    const promptText = (
      calls[0]?.body.input as { content: { text: string }[] }[]
    )[0]?.content[0]?.text;
    expect(promptText).toContain("V6 CREATIVE CONCEPT DIRECTOR TEST");
    expect(promptText).toContain("AUTHORITATIVE RUNTIME INPUT");
    expect(promptText).toContain("RUNTIME OUTPUT ENVELOPE");
    expect(promptText).toContain("Use warm daylight");
    expect(promptText).toContain('"role": "brand-visual-dna"');
    expect(promptText).not.toContain("Convert Cake");
    expect(
      (
        calls[0]?.body.text as {
          format?: { name?: string; schema?: { required?: string[] } };
        }
      ).format
    ).toMatchObject({
      name: "moons_creative_visual_concept",
      schema: {
        required: ["visualConcept"]
      }
    });
  });

  it("uses the archived V6 concept director with set direction in design-system-new mode", async () => {
    const calls: { body: Record<string, unknown> }[] = [];
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        calls.push({
          body: JSON.parse(String(init?.body)) as Record<string, unknown>
        });
        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              visualConcept:
                "A bouquet visibly softens the rigid geometry of a room. The material contrast makes the emotional benefit immediate before the headline completes it. The audience recognizes how one small addition changes the atmosphere."
            })
          }),
          { status: 200 }
        );
      }
    );

    const result = await generateImagePrompt({
      apiKey: "test-key",
      mode: "design-system-new",
      fetchImpl: fetchMock as unknown as typeof fetch,
      loadCreativeGraphicDesignerPrompt: async () =>
        "V6 CREATIVE CONCEPT DIRECTOR TEST",
      input: {
        ...baseInput,
        setDirection:
          "Quiet botanical campaign world with tactile daylight.",
        shotOpportunity:
          "Frame the bouquet through rigid architecture so softness becomes visible."
      }
    });

    expect(result).toContain("A bouquet visibly softens");
    const body = calls[0]?.body;
    expect(body?.text).toMatchObject({
      format: {
        name: "moons_creative_visual_concept",
        schema: { required: ["visualConcept"] }
      }
    });
    const promptText = (
      body?.input as { content: { text: string }[] }[]
    )[0]?.content[0]?.text;
    expect(promptText).toContain("V6 CREATIVE CONCEPT DIRECTOR TEST");
    expect(promptText).toContain("AUTHORITATIVE RUNTIME INPUT");
    expect(promptText).toContain(
      '"campaignSetDirection": "Quiet botanical campaign world'
    );
    expect(promptText).toContain(
      '"shotOpportunity": "Frame the bouquet through rigid architecture'
    );
    expect(promptText).not.toContain("LOCKED AUTHORITATIVE CAMPAIGN PACKET");
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
            label: "Creative Compass artwork reference — primary",
            imageUrl: "https://example.com/primary.jpg"
          },
          {
            label: "Creative Compass artwork reference — secondary",
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
    expect(promptText).toContain('"workingBrief": {');
    expect(promptText).toContain('"priority": "highest"');
    expect(promptText).toContain(
      '"instruction": "Launch a soft summer bouquet offer."'
    );
    expect(promptText).toContain(
      "Primary artwork contributes abstract composition grammar"
    );
    expect(promptText).toContain(
      "Invent all message-bearing visual content and the background from the approved idea"
    );
    expect(promptText).toContain('"headline": "Flowers that make the room feel softer"');
    expect(promptText).not.toContain('"visualDirection"');
    expect(promptText).not.toContain(
      "Photographic editorial bouquet scene with tactile grain."
    );
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
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        calls.push({
          body: JSON.parse(String(init?.body)) as Record<string, unknown>
        });
        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({ prompt: "Prompt." })
          }),
          { status: 200 }
        );
      }
    );

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
      model: "anthropic/claude-sonnet-5",
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
        model: "anthropic/claude-sonnet-5",
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

describe("generateProductionBrief", () => {
  const productionBrief = [
    "Create one finished 4:5 Facebook advertising artwork.",
    "CENTRAL IDEA",
    "One small product ritual transforms the familiar room.",
    "VISUAL EVENT",
    "A diffuser plume changes the room's reflected mood.",
    "COMPOSITION",
    "Hero right, headline left, quiet upper-left field.",
    "SUBJECT AND ENVIRONMENT",
    "Official diffuser on a lived-in side table.",
    "CAMERA",
    "Eye-level environmental portrait with a restrained crop.",
    "LIGHT AND MATERIAL",
    "Warm window light, soft shadows, tactile stone and glass.",
    "TYPOGRAPHY",
    "Use the exact approved headline and CTA once.",
    "OFFICIAL ASSETS",
    "Image 1 is the exact official product.",
    "IMMUTABLE FACTS",
    "Preserve the approved product, offer, and copy.",
    "DO NOT INVENT",
    "No unsupported claims, prices, or products.",
    "OUTPUT",
    "Render one complete artwork only."
  ].join("\n");

  it("turns the compiled design-system prompt into the required production brief", async () => {
    const calls: Record<string, unknown>[] = [];
    const traces: unknown[] = [];
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({ finalPrompt: productionBrief })
          }),
          { status: 200 }
        );
      }
    );

    const result = await generateProductionBrief({
      apiKey: "test-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
      compiledDesignSystemPrompt: "COMPILED MASTER PROMPT",
      referenceImages: [
        {
          imageUrl: "data:image/png;base64,cHJvZHVjdA==",
          label: "Official product"
        }
      ],
      writeTrace: async (trace) => {
        traces.push(trace);
      }
    });

    expect(result).toBe(productionBrief);
    const input = calls[0]?.input as {
      content: { type: string; text?: string; image_url?: string }[];
    }[];
    expect(input[0]?.content[0]?.text).toContain(
      "# GPT IMAGE 2 PRODUCTION BRIEF DIRECTOR"
    );
    expect(input[0]?.content[0]?.text).toContain("COMPILED MASTER PROMPT");
    expect(input[0]?.content[1]).toMatchObject({
      type: "input_image",
      image_url: "data:image/png;base64,cHJvZHVjdA=="
    });
    expect(traces).toContainEqual(
      expect.objectContaining({
        mode: "design-system-new",
        stage: "production-brief",
        status: "succeeded",
        responsePrompt: productionBrief
      })
    );
  });

  it("rejects a production brief that omits required sections", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            finalPrompt: "Create one finished artwork.\nCENTRAL IDEA\nOne idea."
          })
        }),
        { status: 200 }
      )
    );

    await expect(
      generateProductionBrief({
        apiKey: "test-key",
        fetchImpl: fetchMock as unknown as typeof fetch,
        compiledDesignSystemPrompt: "COMPILED MASTER PROMPT",
        referenceImages: []
      })
    ).rejects.toThrow("Production brief is missing required sections");
  });
});
