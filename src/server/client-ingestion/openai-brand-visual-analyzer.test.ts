import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_BRAND_VISUAL_ANALYSIS_REQUEST_TIMEOUT_MS,
  extractResponseText,
  OpenAiBrandVisualAnalyzer,
  parseBrandSignalAnalysisJson,
  selectBalancedBySource
} from "./openai-brand-visual-analyzer";

const responseAnalysis = {
  brandKitEntries: [
    {
      title: "Brand Details",
      description:
        "Flora Daily เป็นร้านดอกไม้ที่จัดช่อสำหรับของขวัญตามโอกาสและให้บริการจัดส่งในเมือง"
    },
    {
      title: "Target Audience",
      description:
        "Audience: คนที่กำลังหาของขวัญและผู้ซื้อออนไลน์\nPain points: มีเวลาจำกัดและไม่แน่ใจว่าควรเลือกดอกไม้แบบไหน"
    },
    {
      title: "USP",
      description:
        "- จัดช่อให้เหมาะกับแต่ละโอกาส\n- ช่วยให้ผู้ซื้อเลือกของขวัญได้ง่ายขึ้น"
    },
    {
      title: "Mood&Tone",
      description: "อบอุ่น, อ่อนโยน, เป็นธรรมชาติ"
    }
  ],
  learning: [
    {
      polarity: "working",
      note: "Use soft daylight and simple product framing."
    }
  ],
  products: [
    {
      name: "ช่อดอกไม้",
      description: "ช่อดอกไม้สดสำหรับโอกาสพิเศษ",
      offer: "จัดช่อตามโอกาส",
      keyBenefit: "ช่วยเลือกของขวัญได้ง่ายขึ้น",
      audience: "ผู้ที่กำลังมองหาของขวัญ",
      claimNotes: "ไม่พบ claim ด้านประสิทธิภาพ"
    }
  ],
  visualGuidance: {
    mood: ["fresh", "soft"],
    colorPalette: ["cream", "green"],
    layoutPatterns: ["centered product"],
    textOverlay: ["minimal"],
    typographyFeel: ["clean sans"],
    productPersonEnvironment: ["product with natural props"],
    dos: ["keep compositions calm"],
    donts: ["avoid harsh contrast"],
    sourceAssetPaths: ["client-1/job-1/facebook_post/post-1-0.jpg"]
  },
  needsReview: false,
  reviewReason: ""
};

describe("OpenAiBrandVisualAnalyzer", () => {
  it("allows the current analysis model five minutes per visual or text-only attempt", () => {
    expect(DEFAULT_BRAND_VISUAL_ANALYSIS_REQUEST_TIMEOUT_MS).toBe(300_000);
  });

  it("balances Posts and Ads evidence when both sources are available", () => {
    const posts = Array.from({ length: 10 }, (_, index) => ({
      sourceType: "facebook_post" as const,
      id: `post-${index}`
    }));
    const ads = Array.from({ length: 3 }, (_, index) => ({
      sourceType: "facebook_ad" as const,
      id: `ad-${index}`
    }));

    expect(
      selectBalancedBySource([...posts, ...ads], 6).map((item) => item.id)
    ).toEqual(["post-0", "post-1", "post-2", "ad-0", "ad-1", "ad-2"]);
  });

  it("sends mirrored Supabase image URLs to the Responses API and parses structured output", async () => {
    const fetchMock = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify(responseAnalysis)
        }),
        { status: 200 }
      )
    );
    const analyzer = new OpenAiBrandVisualAnalyzer({
      apiKey: "test-key",
      model: "gpt-test",
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    const result = await analyzer.analyze({
      client: {
        id: "client-1",
        name: "Flora Daily",
        facebookUrl: "https://www.facebook.com/flora"
      },
      sourceSummary: {
        postsSaved: 1,
        adsSaved: 0,
        manualInputsSaved: 1,
        usedFallbackSearch: false
      },
      textEvidence: [
        {
          sourceType: "manual_input",
          sourceId: "questionnaire-1",
          text: "Brand Name: Flora Daily. Website: flora.example.com"
        },
        {
          sourceType: "facebook_post",
          sourceId: "post-1",
          text: "ช่อดอกไม้สดสำหรับของขวัญ"
        }
      ],
      visualAssets: [
        {
          assetBucket: "brand-source-assets",
          assetStoragePath: "client-1/job-1/facebook_post/post-1-0.jpg",
          assetUrl: "https://storage.example.com/signed/post-1-0.jpg",
          originalUrlHash: "hash-1",
          sourceId: "source-1",
          sourceType: "facebook_post",
          sourceUrl: "https://www.facebook.com/flora/posts/1",
          sourceItemId: "post-1",
          captionContext: "Fresh flower arrangement"
        }
      ]
    });

    expect(result).toMatchObject(responseAnalysis);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key"
        })
      })
    );

    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) throw new Error("fetch was not called.");
    const [, requestInit] = firstCall;
    const body = JSON.parse(String((requestInit as RequestInit).body)) as {
      model: string;
      store: boolean;
      reasoning: { effort: string };
      input: { content: unknown[] }[];
      text: {
        format: { type: string; strict: boolean; schema?: unknown };
      };
    };

    expect(body.model).toBe("gpt-test");
    expect(body.store).toBe(false);
    expect(body.reasoning).toEqual({ effort: "low" });
    expect(body.text.format).toMatchObject({
      type: "json_schema",
      strict: true
    });
    expect(JSON.stringify(body.input)).toContain(
      "https://storage.example.com/signed/post-1-0.jpg"
    );
    expect(JSON.stringify(body.input)).toContain(
      "client-1/job-1/facebook_post/post-1-0.jpg"
    );
    expect(JSON.stringify(body.input)).not.toContain("data:image");
    expect(JSON.stringify(body.input)).not.toContain("scontent");
    expect(JSON.stringify(body.input)).toContain("ตอบทุก field เป็นภาษาไทย");
    expect(JSON.stringify(body.input)).toContain("ช่อดอกไม้สดสำหรับของขวัญ");
    expect(JSON.stringify(body.input)).toContain("Brand Name: Flora Daily");
    expect(JSON.stringify(body.input)).toContain("first-party");
    expect(JSON.stringify(body.input)).toContain(
      "Brand Details: แบรนด์ทำอะไร"
    );
    expect(JSON.stringify(body.input)).toContain(
      "ใช้รูปแบบ description ให้เหมาะกับข้อมูลของแต่ละหัวข้อ"
    );
    expect(JSON.stringify(body.text.format.schema)).toContain("Brand Details");
  });

  it("bounds and deduplicates large social and image evidence payloads", async () => {
    const fetchMock = vi.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        _init?: Parameters<typeof fetch>[1]
      ) =>
        new Response(
          JSON.stringify({ output_text: JSON.stringify(responseAnalysis) }),
          { status: 200 }
        )
    );
    const analyzer = new OpenAiBrandVisualAnalyzer({
      apiKey: "test-key",
      fetchImpl: fetchMock as unknown as typeof fetch
    });
    const repeatedText = "ข้อเสนอเดิมที่ถูกเก็บซ้ำจากหลายโฆษณา";
    const socialEvidence = [
      ...Array.from({ length: 20 }, (_, index) => ({
        sourceType: "facebook_post" as const,
        sourceId: `post-${index}`,
        text: index < 5 ? repeatedText : `โพสต์ที่ไม่ซ้ำ ${index} ${"ก".repeat(900)}`
      })),
      ...Array.from({ length: 20 }, (_, index) => ({
        sourceType: "facebook_ad" as const,
        sourceId: `ad-${index}`,
        text: `โฆษณาที่ไม่ซ้ำ ${index}`
      }))
    ];
    const visualAssets = Array.from({ length: 12 }, (_, index) => ({
      assetBucket: "brand-source-assets",
      assetStoragePath: `client-1/job-1/facebook_post/post-${index}.jpg`,
      assetUrl: `https://storage.example.com/signed/post-${index}.jpg`,
      originalUrlHash: `hash-${index}`,
      sourceId: `source-${index}`,
      sourceType: (index % 2 === 0 ? "facebook_post" : "facebook_ad") as
        | "facebook_post"
        | "facebook_ad",
      sourceUrl: `https://www.facebook.com/flora/posts/${index}`,
      sourceItemId: `item-${index}`,
      captionContext: `Caption ${index}`
    }));

    await analyzer.analyze({
      client: {
        id: "client-1",
        name: "Flora Daily",
        facebookUrl: "https://www.facebook.com/flora"
      },
      sourceSummary: {
        postsSaved: 20,
        adsSaved: 20,
        manualInputsSaved: 0,
        usedFallbackSearch: false
      },
      textEvidence: socialEvidence,
      visualAssets
    });

    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)
    ) as {
      input: {
        content: { type: string; text?: string; detail?: string }[];
      }[];
    };
    const content = body.input[0]?.content ?? [];
    const prompt = content[0]?.text ?? "";

    expect(content.filter((item) => item.type === "input_image")).toHaveLength(8);
    expect(
      content
        .filter((item) => item.type === "input_image")
        .every((item) => item.detail === "low")
    ).toBe(true);
    expect(prompt.match(new RegExp(repeatedText, "g"))).toHaveLength(1);
    expect(prompt.match(/\[facebook_(?:post|ad):/g)).toHaveLength(24);
    expect(prompt).not.toContain("ก".repeat(701));
  });

  it("falls back to text evidence and requires review when OpenAI rejects an image request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              type: "invalid_request_error",
              code: "invalid_image_url",
              message: "The image could not be downloaded."
            }
          }),
          {
            status: 400,
            headers: { "x-request-id": "req-image-failure" }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output_text: JSON.stringify(responseAnalysis)
          }),
          { status: 200 }
        )
      );
    const analyzer = new OpenAiBrandVisualAnalyzer({
      apiKey: "test-key",
      model: "gpt-test",
      fetchImpl: fetchMock as unknown as typeof fetch,
      retryDelayMs: 0
    });

    const result = await analyzer.analyze({
      client: {
        id: "client-1",
        name: "Flora Daily",
        facebookUrl: "https://www.facebook.com/flora"
      },
      sourceSummary: {
        postsSaved: 1,
        adsSaved: 0,
        manualInputsSaved: 1,
        usedFallbackSearch: false
      },
      textEvidence: [
        {
          sourceType: "manual_input",
          sourceId: "questionnaire-1",
          text: "Brand Name: Flora Daily. Website: flora.example.com"
        }
      ],
      visualAssets: [
        {
          assetBucket: "brand-source-assets",
          assetStoragePath: "client-1/job-1/facebook_post/post-1-0.jpg",
          assetUrl: "https://storage.example.com/signed/post-1-0.jpg",
          originalUrlHash: "hash-1",
          sourceId: "source-1",
          sourceType: "facebook_post",
          sourceUrl: "https://www.facebook.com/flora/posts/1",
          sourceItemId: "post-1",
          captionContext: "Fresh flower arrangement"
        }
      ]
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)
    );
    const secondBody = JSON.parse(
      String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)
    );
    expect(JSON.stringify(firstBody.input)).toContain("input_image");
    expect(JSON.stringify(secondBody.input)).not.toContain("input_image");
    expect(result.needsReview).toBe(true);
    expect(result.reviewReason).toContain("text evidence only");
    expect(result.reviewReason).toContain("invalid_image_url");
    expect(result.visualGuidance.sourceAssetPaths).toEqual([]);
  });

  it("bounds a stalled image request and falls back to text evidence", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        async (
          _input: Parameters<typeof fetch>[0],
          init?: Parameters<typeof fetch>[1]
        ) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output_text: JSON.stringify(responseAnalysis)
          }),
          { status: 200 }
        )
      );
    const analyzer = new OpenAiBrandVisualAnalyzer({
      apiKey: "test-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
      requestTimeoutMs: 5,
      retryDelayMs: 0
    });

    const result = await analyzer.analyze({
      client: {
        id: "client-1",
        name: "Flora Daily",
        facebookUrl: "https://www.facebook.com/flora"
      },
      sourceSummary: {
        postsSaved: 1,
        adsSaved: 0,
        manualInputsSaved: 1,
        usedFallbackSearch: false
      },
      textEvidence: [
        {
          sourceType: "manual_input",
          sourceId: "questionnaire-1",
          text: "Brand Name: Flora Daily"
        }
      ],
      visualAssets: [
        {
          assetBucket: "brand-source-assets",
          assetStoragePath: "client-1/job-1/facebook_post/post-1-0.jpg",
          assetUrl: "https://storage.example.com/signed/post-1-0.jpg",
          originalUrlHash: "hash-1",
          sourceId: "source-1",
          sourceType: "facebook_post",
          sourceUrl: "https://www.facebook.com/flora/posts/1",
          sourceItemId: "post-1",
          captionContext: "Fresh flower arrangement"
        }
      ]
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.needsReview).toBe(true);
    expect(result.reviewReason).toContain("timed out");
    expect(result.visualGuidance.sourceAssetPaths).toEqual([]);
  });

  it("retries a temporary OpenAI failure before degrading the analysis", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              type: "rate_limit_error",
              code: "rate_limit_exceeded",
              message: "Please retry shortly."
            }
          }),
          { status: 429 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output_text: JSON.stringify(responseAnalysis)
          }),
          { status: 200 }
        )
      );
    const analyzer = new OpenAiBrandVisualAnalyzer({
      apiKey: "test-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
      retryDelayMs: 0
    });

    const result = await analyzer.analyze({
      client: {
        id: "client-1",
        name: "Flora Daily",
        facebookUrl: "https://www.facebook.com/flora"
      },
      sourceSummary: {
        postsSaved: 0,
        adsSaved: 0,
        manualInputsSaved: 1,
        usedFallbackSearch: false
      },
      textEvidence: [
        {
          sourceType: "manual_input",
          sourceId: "questionnaire-1",
          text: "Brand Name: Flora Daily"
        }
      ],
      visualAssets: []
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.needsReview).toBe(false);
  });

  it("includes OpenAI error details and request IDs when recovery is not possible", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              type: "invalid_request_error",
              code: "invalid_api_key",
              message: "Incorrect API key."
            }
          }),
          {
            status: 401,
            headers: { "x-request-id": "req-unauthorized" }
          }
        )
    );
    const analyzer = new OpenAiBrandVisualAnalyzer({
      apiKey: "test-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
      retryDelayMs: 0
    });

    await expect(
      analyzer.analyze({
        client: {
          id: "client-1",
          name: "Flora Daily",
          facebookUrl: "https://www.facebook.com/flora"
        },
        sourceSummary: {
          postsSaved: 0,
          adsSaved: 0,
          manualInputsSaved: 1,
          usedFallbackSearch: false
        },
        textEvidence: [
          {
            sourceType: "manual_input",
            sourceId: "questionnaire-1",
            text: "Brand Name: Flora Daily"
          }
        ],
        visualAssets: []
      })
    ).rejects.toThrow(
      "OpenAI visual analysis failed (401, request req-unauthorized): invalid_api_key — Incorrect API key."
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("extracts output text from Responses API output content", () => {
    const text = extractResponseText({
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify(responseAnalysis)
            }
          ]
        }
      ]
    });

    expect(parseBrandSignalAnalysisJson(text)).toMatchObject(responseAnalysis);
  });

  it("requires at least one mirrored image URL", async () => {
    const analyzer = new OpenAiBrandVisualAnalyzer({
      apiKey: "test-key",
      fetchImpl: vi.fn() as unknown as typeof fetch
    });

    await expect(
      analyzer.analyze({
        client: {
          id: "client-1",
          name: "Flora Daily",
          facebookUrl: "https://www.facebook.com/flora"
        },
        sourceSummary: {
          postsSaved: 0,
          adsSaved: 0,
          manualInputsSaved: 0,
          usedFallbackSearch: false
        },
        textEvidence: [],
        visualAssets: []
      })
    ).rejects.toThrow("No brand evidence");
  });
});
