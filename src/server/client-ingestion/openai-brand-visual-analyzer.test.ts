import { describe, expect, it, vi } from "vitest";
import {
  extractResponseText,
  OpenAiBrandVisualAnalyzer,
  parseBrandSignalAnalysisJson,
  selectBalancedBySource
} from "./openai-brand-visual-analyzer";

const responseAnalysis = {
  brandKitEntries: [
    {
      title: "Visual mood",
      description: "Fresh, soft, natural product-led visuals."
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
      input: { content: unknown[] }[];
      text: { format: { type: string; strict: boolean } };
    };

    expect(body.model).toBe("gpt-test");
    expect(body.store).toBe(false);
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
