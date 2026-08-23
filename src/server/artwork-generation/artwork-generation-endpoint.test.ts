import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  albumCropRegions,
  buildActiveHumanPresenceRules,
  detectAlbumBoundaries,
  handleArtworkGenerationRequest,
  inspectFourGridMasterAlignment,
  normalizeFourGridMaster,
  normalizeReferenceImageForOpenAI,
  type ArtworkStorageClient
} from "./artwork-generation-endpoint";
import { splitAlbumMaster } from "./album-master";

const requestBody = {
  model: "gpt-image-2",
  artworkMode: "standard",
  imagePromptModel: "gpt-5.6-terra",
  runId: "run-1",
  brand: {
    id: "flora",
    name: "Flora Daily",
    category: "Flowers / lifestyle"
  },
  service: "single-static",
  quantity: 1,
  brief: "Launch a soft summer bouquet offer.",
  selectedHooks: [
    {
      id: "hook-1",
      hook: "Flowers that make the room feel softer",
      concept: "Lead with room mood.",
      why: "Connects the offer to a clear room mood.",
      visual: "Soft natural light with bouquet on table.",
      cta: "Order a bouquet",
      caption: "Fresh flowers for calm homes."
    }
  ],
  textInputs: [],
  referenceImages: [],
  output: {
    size: "1024x1024",
    format: "png"
  }
};

function buildRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://moons.local/api/artwork-generation", {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody)
  });
}

describe("reference image normalization", () => {
  it("converts CMYK JPEG references to an sRGB JPEG", async () => {
    const cmykReference = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: { r: 210, g: 160, b: 90 }
      }
    })
      .toColourspace("cmyk")
      .jpeg()
      .toBuffer();

    expect((await sharp(cmykReference).metadata()).space).toBe("cmyk");

    const normalized = await normalizeReferenceImageForOpenAI({
      bytes: cmykReference,
      mimeType: "image/jpeg",
      label: "IMG_8561.JPG"
    });

    expect(normalized.mimeType).toBe("image/jpeg");
    expect((await sharp(normalized.bytes).metadata()).space).toBe("srgb");
  });

  it("names an invalid JPEG in the validation error", async () => {
    await expect(
      normalizeReferenceImageForOpenAI({
        bytes: Buffer.from("not-a-jpeg"),
        mimeType: "image/jpeg",
        label: "IMG_8561.JPG"
      })
    ).rejects.toThrow('Reference image "IMG_8561.JPG" is not a valid JPEG.');
  });
});

function promptAgentResponse(
  prompt = "AGENT-WRITTEN PROMPT: production-ready artwork."
): Response {
  return new Response(
    JSON.stringify({
      output_text: JSON.stringify({ finalPrompt: prompt })
    }),
    { status: 200 }
  );
}

function creativeGraphicDesignerResponse(
  direction =
    "A bouquet appears to soften the hard geometry of a room: rigid architectural shadows visibly relax into gentle curves around the flowers, making the emotional benefit instantly visible and specific to the offer.",
  overrides: Record<string, unknown> = {}
): Response {
  return new Response(
    JSON.stringify({
      output_text: JSON.stringify({
        visualConcept: direction,
        brand: "Flora Daily",
        productOrService: "Flower delivery service",
        headline: "Flowers that make the room feel softer",
        highlightedPhrase: "room feel softer",
        featureName: "OMIT",
        featureValueProposition: "OMIT",
        supportingConversionLine: "OMIT",
        cta: "Order a bouquet",
        requiredUtilityInformation: "OMIT",
        brandPalette: "OMIT",
        officialAssets: "OMIT",
        ...overrides
      })
    }),
    { status: 200 }
  );
}

function responseForArtworkAgentRequest(init?: RequestInit): Response {
  const body = JSON.parse(String(init?.body)) as {
    text?: { format?: { name?: string } };
  };
  if (body.text?.format?.name === "moons_album_panel_separation_review") {
    return albumPanelQcPassResponse();
  }
  return body.text?.format?.name === "moons_creative_visual_concept"
    ? creativeGraphicDesignerResponse()
    : strategyAgentResponse();
}

function strategyAgentResponse(
  overrides: Record<string, unknown> = {}
): Response {
  return new Response(
    JSON.stringify({
      output_text: JSON.stringify({
        commercialStyle: "lifestyle",
        sellingMechanism: "desire",
        preferredMode: "standard_commercial",
        preferredLayout: "lifestyle_commercial",
        preferredHeroType: "person",
        humanPresence: "essential",
        audienceMoment: "The customer wants to feel more confident.",
        reasonToBelieve: "Show the desired lived experience directly.",
        visibleProofDirection: "A human-centered beauty result moment.",
        offer: { text: "", evidenceId: "", source: "none" },
        proof: [],
        differentiator: { text: "", evidenceId: "", source: "none" },
        referenceSearchText:
          "beauty lifestyle commercial human photographic composite",
        evidenceStatus: "none",
        requiresTextReview: false,
        missingEvidence: ["verified offer", "verified proof"],
        ...overrides
      })
    }),
    { status: 200 }
  );
}

function creativeVisualConceptResponse(
  visualConcept =
    "A bouquet visibly softens the rigid geometry of a room. The material contrast makes the emotional benefit immediate before the headline completes it. The audience recognizes how one small addition changes the atmosphere."
): Response {
  return new Response(
    JSON.stringify({
      output_text: JSON.stringify({ visualConcept })
    }),
    { status: 200 }
  );
}

function creativeSetDirectionResponse(): Response {
  return new Response(
    JSON.stringify({
      output_text: JSON.stringify({
        setDirection:
          "A quiet botanical campaign world with tactile daylight and disciplined editorial restraint.",
        ideas: [
          {
            directionId: "hook-1",
            shotOpportunity:
              "Frame the bouquet through a rigid architectural foreground so its softness visibly changes the room."
          }
        ]
      })
    }),
    { status: 200 }
  );
}

function visualQualityPassResponse(): Response {
  return new Response(
    JSON.stringify({
      output_text: JSON.stringify({
        decision: "pass",
        density: "controlled",
        aiAppearance: "credible",
        strengths: ["Clear hierarchy", "Natural light and shadow"],
        issues: [],
        revisionInstruction: ""
      })
    }),
    { status: 200 }
  );
}

function albumPanelQcPassResponse(): Response {
  return new Response(
    JSON.stringify({
      output_text: JSON.stringify({
        decision: "pass",
        affectedPanels: [],
        issue: "",
        revisionInstruction: ""
      })
    }),
    { status: 200 }
  );
}

function campaignInputPreflightResponse(ratio = "1:1"): Response {
  return new Response(
    JSON.stringify({
      output_text: JSON.stringify({
        brand: {
          name: "Flora Daily",
          category: "Flowers / lifestyle",
          colors: []
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
        output: { service: "static", ratio }
      })
    }),
    { status: 200 }
  );
}

function standardAgentResponse(init?: RequestInit): Response {
  const body = JSON.parse(String(init?.body)) as {
    input?: { content?: { text?: string }[] }[];
    text?: { format?: { name?: string } };
  };
  if (
    body.text?.format?.name === "moons_album_panel_separation_review"
  ) {
    return albumPanelQcPassResponse();
  }
  if (body.text?.format?.name !== "moons_campaign_input_preflight") {
    return visualQualityPassResponse();
  }
  const inputText = body.input?.[0]?.content?.[0]?.text ?? "";
  const ratio = /"ratio":\s*"([^"]+)"/.exec(inputText)?.[1] ?? "1:1";
  return campaignInputPreflightResponse(ratio);
}

function visualQualityReviseResponse(): Response {
  return new Response(
    JSON.stringify({
      output_text: JSON.stringify({
        decision: "revise",
        density: "too-dense",
        aiAppearance: "noticeable",
        strengths: ["Strong botanical focal idea"],
        issues: ["Crowded lower edge", "Product contact shadow feels detached"],
        revisionInstruction:
          "Open the lower quiet zone and correct the product contact shadow while preserving the concept, copy, brand assets, and crop."
      })
    }),
    { status: 200 }
  );
}

describe("active human-presence prompt rules", () => {
  it("compiles only the explicit human-presence policy", () => {
    expect(buildActiveHumanPresenceRules("avoid")).toContain(
      "Do not use people, faces, bodies, portraits, or hands"
    );
    expect(buildActiveHumanPresenceRules("supporting")).toContain(
      "remain clearly subordinate"
    );
    expect(buildActiveHumanPresenceRules("essential")).toContain(
      "Human presence is essential"
    );
  });

  it("uses a neutral rule when no human-presence policy is supplied", () => {
    expect(buildActiveHumanPresenceRules(undefined)).toBe(
      "Infer whether human presence materially improves the campaign message. Do not add people merely as decoration, but do not prohibit people by default."
    );
  });
});

async function albumMasterPng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 512,
      height: 512,
      channels: 3,
      background: { r: 232, g: 238, b: 255 }
    }
  })
    .png()
    .toBuffer();
}

async function fourGridMasterPng({
  vertical,
  horizontal
}: {
  vertical: number;
  horizontal: number;
}): Promise<Buffer> {
  const width = 512;
  const height = 512;
  return sharp(syntheticAlbumMaster({
    width,
    height,
    format: "four-grid",
    vertical,
    horizontal
  }), {
    raw: { width, height, channels: 1 }
  })
    .png()
    .toBuffer();
}

function fakeStorage(): {
  client: ArtworkStorageClient;
  uploads: { bucket: string; path: string }[];
} {
  const uploads: { bucket: string; path: string }[] = [];
  const client: ArtworkStorageClient = {
    storage: {
      from(bucket: string) {
        return {
          async upload(path: string) {
            uploads.push({ bucket, path });
            return { error: null };
          },
          async createSignedUrl(path: string) {
            return {
              data: {
                signedUrl: `https://example.supabase.co/storage/v1/object/sign/${bucket}/${path}`
              },
              error: null
            };
          },
          async download() {
            return { data: null, error: { message: "Not found" } };
          }
        };
      }
    }
  };
  return { client, uploads };
}

async function captureDesignSystemGenerationPrompt(
  overrides: Record<string, unknown>
): Promise<string> {
  const imageBodies: Array<{ prompt: string }> = [];
  const fetchMock = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/auth/v1/user")) {
        return new Response(
          JSON.stringify({ email: "team@convertcake.com" }),
          { status: 200 }
        );
      }
      if (href === "https://example.com/logo.png") {
        return new Response(Buffer.from("official-logo"), {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
      if (href.includes("/v1/responses")) {
        const body = JSON.parse(String(init?.body)) as {
          text?: { format?: { name?: string } };
        };
        if (body.text?.format?.name === "moons_creative_visual_concept") {
          const requestText = String(init?.body);
          return requestText.includes("วิเคราะห์ Budget Allocation ตาม KPI")
            ? creativeGraphicDesignerResponse(
                "A disciplined allocation visual makes the cost of mismatched budget and campaign objectives immediately visible. The approved headline sharpens the tension between spending more and planning better. The audience recognizes a familiar performance problem and sees a credible planning path.",
                {
                  brand: "Convert Cake Ads",
                  productOrService: "Performance Marketing Agency",
                  headline: "ยอดขายนิ่ง อาจไม่ใช่เพราะงบน้อย",
                  highlightedPhrase: "ไม่ใช่เพราะงบน้อย",
                  featureName: "Budget Allocation",
                  featureValueProposition:
                    "วิเคราะห์ Budget Allocation ตาม KPI",
                  supportingConversionLine:
                    "พิจารณาความเหมาะสมของ Platform และเป้าหมายแคมเปญ",
                  cta: "ขอวางแผนงบ",
                  brandPalette: "#1D48F3, #000E3F, #FFFFFF",
                  officialAssets: "Image 1: official logo"
                }
              )
            : creativeGraphicDesignerResponse(undefined, {
                supportingConversionLine:
                  "Hand-arranged seasonal stems",
                requiredUtilityInformation:
                  "Same-day delivery in Bangkok",
                officialAssets:
                  "Image 1: official logo; Image 2: style reference"
              });
        }
        const requestText = String(init?.body);
        return requestText.includes("วิเคราะห์ Budget Allocation ตาม KPI")
          ? strategyAgentResponse({
              offer: {
                text: "วิเคราะห์ Budget Allocation ตาม KPI",
                evidenceId: "supporting-point:0",
                source: "verified"
              },
              proof: [
                {
                  text: "พิจารณาความเหมาะสมของ Platform และเป้าหมายแคมเปญ",
                  evidenceId: "supporting-point:1",
                  source: "verified"
                }
              ],
              evidenceStatus: "verified",
              missingEvidence: []
            })
          : strategyAgentResponse({
              offer: {
                text: "Same-day delivery in Bangkok",
                evidenceId: "supporting-point:0",
                source: "verified"
              },
              proof: [
                {
                  text: "Hand-arranged seasonal stems",
                  evidenceId: "supporting-point:1",
                  source: "verified"
                }
              ],
              evidenceStatus: "verified",
              missingEvidence: []
            });
      }
      if (href.includes("/v1/images/edits")) {
        imageBodies.push({
          prompt: String((init?.body as FormData).get("prompt"))
        });
        return new Response(
          JSON.stringify({
            data: [
              {
                b64_json: Buffer.from("fake-png-bytes").toString("base64")
              }
            ]
          }),
          { status: 200 }
        );
      }
      if (href.includes("/v1/images/generations")) {
        imageBodies.push(
          JSON.parse(String(init?.body)) as { prompt: string }
        );
        return new Response(
          JSON.stringify({
            data: [
              {
                b64_json: Buffer.from("fake-png-bytes").toString("base64")
              }
            ]
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected fetch: ${href}`);
    }
  );
  const { client } = fakeStorage();
  const response = await handleArtworkGenerationRequest({
    request: new Request("https://moons.local/api/artwork-generation", {
      method: "POST",
      headers: { authorization: "Bearer user-token" },
      body: JSON.stringify({
        ...requestBody,
        artworkMode: "design-system",
        ...overrides
      })
    }),
    env: {
      OPENAI_API_KEY: "test-key",
      SUPABASE_URL: "https://supabase.example.com",
      SUPABASE_ANON_KEY: "anon-key"
    },
    fetchImpl: fetchMock as unknown as typeof fetch,
    createStorageClient: () => client
  });

  expect(response.status, await response.clone().text()).toBe(200);
  expect(imageBodies).toHaveLength(1);
  return imageBodies[0]!.prompt;
}

function syntheticFourVerticalMaster({
  width,
  height,
  vertical,
  firstHorizontal,
  secondHorizontal
}: {
  width: number;
  height: number;
  vertical: number;
  firstHorizontal: number;
  secondHorizontal: number;
}): Uint8Array {
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 42;
      if (x >= vertical) {
        value =
          y < firstHorizontal ? 92 : y < secondHorizontal ? 148 : 204;
      }
      if (
        Math.abs(x - vertical) <= 2 ||
        (x >= vertical &&
          (Math.abs(y - firstHorizontal) <= 2 ||
            Math.abs(y - secondHorizontal) <= 2))
      ) {
        value = 252;
      }
      pixels[y * width + x] = value;
    }
  }
  return pixels;
}

function syntheticAlbumMaster({
  width,
  height,
  format,
  vertical,
  horizontal
}: {
  width: number;
  height: number;
  format: "three-vertical" | "three-horizontal" | "four-grid";
  vertical: number;
  horizontal: number;
}): Uint8Array {
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 42;
      if (format === "three-vertical") {
        value = x < vertical ? 42 : y < horizontal ? 112 : 198;
      } else if (format === "three-horizontal") {
        value = y < horizontal ? 42 : x < vertical ? 112 : 198;
      } else {
        value =
          y < horizontal
            ? x < vertical
              ? 42
              : 92
            : x < vertical
              ? 152
              : 208;
      }
      const onVertical =
        Math.abs(x - vertical) <= 2 &&
        (format !== "three-horizontal" || y >= horizontal);
      const onHorizontal =
        Math.abs(y - horizontal) <= 2 &&
        (format !== "three-vertical" || x >= vertical);
      if (onVertical || onHorizontal) value = 252;
      pixels[y * width + x] = value;
    }
  }
  return pixels;
}

describe("adaptive album crop detection", () => {
  it("rejects a four-grid master whose divider drifts beyond two percent", async () => {
    const shifted = await fourGridMasterPng({
      vertical: 256,
      horizontal: 280
    });
    const centered = await fourGridMasterPng({
      vertical: 256,
      horizontal: 256
    });

    await expect(inspectFourGridMasterAlignment(shifted)).resolves.toMatchObject({
      valid: false,
      horizontalPercent: expect.any(Number)
    });
    await expect(inspectFourGridMasterAlignment(centered)).resolves.toMatchObject({
      valid: true,
      verticalPercent: expect.any(Number),
      horizontalPercent: expect.any(Number)
    });
  });

  it("normalizes a shifted four-grid master into an exact two-by-two grid", async () => {
    const shifted = await fourGridMasterPng({
      vertical: 244,
      horizontal: 280
    });

    const normalized = await normalizeFourGridMaster(shifted);

    await expect(inspectFourGridMasterAlignment(normalized)).resolves.toMatchObject({
      valid: true,
      verticalPercent: 50,
      horizontalPercent: 50
    });
    await expect(sharp(normalized).metadata()).resolves.toMatchObject({
      width: 512,
      height: 512,
      format: "png"
    });
  });

  it("finds shifted four-vertical seams instead of assuming fixed thirds", () => {
    const width = 512;
    const height = 512;
    const boundaries = detectAlbumBoundaries({
      pixels: syntheticFourVerticalMaster({
        width,
        height,
        vertical: 286,
        firstHorizontal: 142,
        secondHorizontal: 358
      }),
      width,
      height,
      format: "four-vertical"
    });

    expect(boundaries.vertical).toBeGreaterThanOrEqual(282);
    expect(boundaries.vertical).toBeLessThanOrEqual(290);
    expect(boundaries.secondaryHorizontal).toBeGreaterThanOrEqual(138);
    expect(boundaries.secondaryHorizontal).toBeLessThanOrEqual(146);
    expect(boundaries.horizontal).toBeGreaterThanOrEqual(354);
    expect(boundaries.horizontal).toBeLessThanOrEqual(362);

    const regions = albumCropRegions({
      left: 0,
      top: 0,
      side: width,
      format: "four-vertical",
      boundaries
    });
    expect(regions[0]).toMatchObject({ index: 1, width: 342, height });
    expect(regions[1]).toMatchObject({ index: 2, left: 342, height: 170 });
    expect(regions[2]).toMatchObject({ index: 3, left: 342, top: 170 });
    expect(regions[3]).toMatchObject({ index: 4, left: 342, top: 341 });
  });

  it.each([
    {
      format: "three-vertical" as const,
      vertical: 232,
      horizontal: 284
    },
    {
      format: "three-horizontal" as const,
      vertical: 276,
      horizontal: 238
    },
    {
      format: "four-grid" as const,
      vertical: 244,
      horizontal: 270
    }
  ])("detects shifted seams for $format", ({
    format,
    vertical,
    horizontal
  }) => {
    const width = 512;
    const height = 512;
    const boundaries = detectAlbumBoundaries({
      pixels: syntheticAlbumMaster({
        width,
        height,
        format,
        vertical,
        horizontal
      }),
      width,
      height,
      format
    });
    const detectedVertical =
      format === "three-horizontal"
        ? boundaries.secondaryVertical
        : boundaries.vertical;
    const detectedHorizontal =
      format === "three-vertical"
        ? boundaries.secondaryHorizontal
        : boundaries.horizontal;

    expect(detectedVertical).toBeGreaterThanOrEqual(vertical - 5);
    expect(detectedVertical).toBeLessThanOrEqual(vertical + 5);
    expect(detectedHorizontal).toBeGreaterThanOrEqual(horizontal - 5);
    expect(detectedHorizontal).toBeLessThanOrEqual(horizontal + 5);
  });

  it.each([
    {
      format: "three-vertical" as const,
      boundaries: {
        vertical: 238,
        secondaryHorizontal: 272
      },
      count: 3
    },
    {
      format: "three-horizontal" as const,
      boundaries: {
        horizontal: 246,
        secondaryVertical: 278
      },
      count: 3
    },
    {
      format: "four-grid" as const,
      boundaries: {
        vertical: 252,
        horizontal: 264
      },
      count: 4
    }
  ])("cuts $format into valid deterministic regions", ({
    format,
    boundaries,
    count
  }) => {
    const regions = albumCropRegions({
      left: 0,
      top: 0,
      side: 512,
      format,
      boundaries
    });

    expect(regions).toHaveLength(count);
    regions.forEach((region) => {
      expect(region.width).toBeGreaterThan(0);
      expect(region.height).toBeGreaterThan(0);
    });
  });

  it("always cuts four-grid into four equal non-overlapping 1:1 panels", () => {
    const regions = albumCropRegions({
      left: 12,
      top: 18,
      side: 513,
      format: "four-grid",
      boundaries: {
        vertical: 219,
        horizontal: 301
      }
    });

    expect(regions).toMatchObject([
      { index: 1, left: 12, top: 18, width: 256, height: 256 },
      { index: 2, left: 269, top: 18, width: 256, height: 256 },
      { index: 3, left: 12, top: 275, width: 256, height: 256 },
      { index: 4, left: 269, top: 275, width: 256, height: 256 }
    ]);
    regions.forEach((region) => expect(region.width).toBe(region.height));
  });

  it.each([
    "three-vertical",
    "three-horizontal",
    "four-vertical",
    "four-grid"
  ] as const)("preserves the intended panel ratios for %s", async (format) => {
    const master = await sharp({
      create: {
        width: 513,
        height: 513,
        channels: 3,
        background: { r: 232, g: 238, b: 255 }
      }
    })
      .png()
      .toBuffer();

    const panels = await splitAlbumMaster(master, format);
    const expectedRatios: Record<typeof format, readonly number[]> = {
      "three-vertical": [0.5, 1, 1],
      "three-horizontal": [2, 1, 1],
      "four-vertical": [2 / 3, 1, 1, 1],
      "four-grid": [1, 1, 1, 1]
    };

    expect(panels).toHaveLength(format.startsWith("three-") ? 3 : 4);
    await Promise.all(
      panels.map(async (panel, index) => {
        const metadata = await sharp(panel.bytes).metadata();
        expect(metadata.width).toBeDefined();
        expect(metadata.height).toBeDefined();
        expect(metadata.width! / metadata.height!).toBeCloseTo(
          expectedRatios[format][index]!,
          2
        );
      })
    );
  });
});

describe("handleArtworkGenerationRequest", () => {
  it("requires a Supabase user token when backend Supabase env is configured", async () => {
    const response = await handleArtworkGenerationRequest({
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

  it("interprets every Hook reference and attaches them to the final GPT Image 2 edit", async () => {
    let editForm: FormData | undefined;
    let interpreterBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url);
        if (href.includes("/auth/v1/user")) {
          return new Response(JSON.stringify({ email: "team@convertcake.com" }), {
            status: 200
          });
        }
        if (href === "https://example.com/hook-reference.png") {
          return new Response(Buffer.from("reference-image"), {
            status: 200,
            headers: { "content-type": "image/png" }
          });
        }
        if (href === "https://example.com/supporting-reference.png") {
          return new Response(Buffer.from("supporting-reference"), {
            status: 200,
            headers: { "content-type": "image/png" }
          });
        }
        if (href === "https://example.com/official-logo.png") {
          return new Response(Buffer.from("official-logo"), {
            status: 200,
            headers: { "content-type": "image/png" }
          });
        }
        if (href.includes("/v1/images/edits")) {
          editForm = init?.body as FormData;
          return new Response(
            JSON.stringify({
              data: [
                { b64_json: Buffer.from("reference-led-output").toString("base64") }
              ]
            }),
            { status: 200 }
          );
        }
        if (href.includes("/v1/responses")) {
          interpreterBody = JSON.parse(String(init?.body)) as Record<
            string,
            unknown
          >;
          return new Response(
            JSON.stringify({
              output_text: JSON.stringify({
                artworkConcept: "Reveal an invisible problem through a cutaway.",
                keyVisualGrammar: "One physical cutaway is the proof mechanism.",
                compositionGrammar: "Asymmetric editorial grid.",
                graphicDeviceLogic: "A footer groups secondary proof.",
                hierarchyAndDensity: "One dominant headline and one hero.",
                secondaryAndFooterGrammar: "Grounded green footer zone.",
                conceptTranslation: "Create a new mattress cutaway hero.",
                preserve: ["editorial hierarchy", "green footer device"],
                replace: ["source people", "source cleaning scene"]
              })
            }),
            { status: 200 }
          );
        }
        throw new Error(`Unexpected fetch: ${href}`);
      }
    );
    const { client } = fakeStorage();
    const response = await handleArtworkGenerationRequest({
      request: new Request("https://moons.local/api/artwork-generation", {
        method: "POST",
        headers: { authorization: "Bearer user-token" },
        body: JSON.stringify({
          ...requestBody,
          artworkMode: "design-system-new",
          referenceLed: true,
          selectedHooks: [
            {
              ...requestBody.selectedHooks[0],
              subheadline: "One calm supporting line",
              supportingPoints: [
                "Do not render point one",
                "Do not render point two"
              ]
            }
          ],
          referenceImages: [
            {
              kind: "url",
              url: "https://example.com/official-logo.png",
              label: "Logo reference · Official identity only"
            },
            {
              kind: "url",
              url: "https://example.com/hook-reference.png",
              label: "Primary reference · Style · Client example"
            },
            {
              kind: "url",
              url: "https://example.com/supporting-reference.png",
              label: "Supporting reference · Style · Typography example"
            }
          ]
        })
      }),
      env: {
        OPENAI_API_KEY: "test-key",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      writeDebugLog: async () => undefined,
      createStorageClient: () => client
    });

    expect(response.status, await response.clone().text()).toBe(200);
    const prompt = String(editForm?.get("prompt"));
    expect(prompt).toContain("# DESIGN-GRAMMAR-LED GENERATION");
    expect(prompt).toContain("AUTHORITY ORDER IS MANDATORY");
    expect(prompt).toContain("Brand CI wins without compromise");
    expect(prompt).toContain("key-visual mechanism");
    expect(prompt).toContain("Create a new mattress cutaway hero");
    expect(prompt).toContain("source people");
    expect(prompt).toContain("One calm supporting line");
    expect(prompt).not.toContain("Do not render point one");
    expect(prompt).not.toContain("AUTHORITATIVE PREFLIGHTED CAMPAIGN INPUT");
    expect(prompt).toContain("Primary reference · Style · Client example");
    expect(prompt).toContain(
      "Supporting reference · Style · Typography example"
    );
    expect(editForm?.getAll("image[]")).toHaveLength(3);
    expect(JSON.stringify(interpreterBody)).toContain("input_image");
    expect(JSON.stringify(interpreterBody)).toContain(
      "REFERENCE SCOPE IS STRICT"
    );
    expect(JSON.stringify(interpreterBody)).toContain(
      "never transfer the reference brand's colors"
    );
    expect(JSON.stringify(interpreterBody)).toContain(
      Buffer.from("reference-image").toString("base64")
    );
    expect(JSON.stringify(interpreterBody)).toContain(
      Buffer.from("supporting-reference").toString("base64")
    );
    expect(JSON.stringify(interpreterBody)).not.toContain(
      Buffer.from("official-logo").toString("base64")
    );
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).includes("/v1/responses")
      )
    ).toHaveLength(1);
  });

  it("revises the current image directly without invoking prompt or strategy agents", async () => {
    let editForm: FormData | undefined;
    const fetchMock = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url);
        if (href.includes("/auth/v1/user")) {
          return new Response(
            JSON.stringify({ email: "team@convertcake.com" }),
            { status: 200 }
          );
        }
        if (href === "https://example.com/current-artwork.png") {
          return new Response(Buffer.from("current-image"), {
            status: 200,
            headers: { "content-type": "image/png" }
          });
        }
        if (href.includes("/v1/images/edits")) {
          editForm = init?.body as FormData;
          return new Response(
            JSON.stringify({
              data: [
                { b64_json: Buffer.from("revised-image").toString("base64") }
              ]
            }),
            { status: 200 }
          );
        }
        if (href.includes("/v1/responses")) {
          throw new Error("Controlled revision must not invoke a prompt agent.");
        }
        throw new Error(`Unexpected fetch: ${href}`);
      }
    );
    const revisionRequest = new Request(
      "https://moons.local/api/artwork-generation",
      {
        method: "POST",
        headers: { authorization: "Bearer user-token" },
        body: JSON.stringify({
          requestType: "artwork-revision",
          model: "gpt-image-2",
          clientId: "flora",
          runId: "run-1",
          outputId: "hook-1-v1",
          directionId: "hook-1",
          format: "1:1 Static",
          sourceImageUrl: "https://example.com/current-artwork.png",
          instructions: "Increase whitespace around the CTA.",
          output: { size: "1024x1024", format: "png" }
        })
      }
    );
    const { client, uploads } = fakeStorage();
    const debugLogs: unknown[] = [];

    const response = await handleArtworkGenerationRequest({
      request: revisionRequest,
      env: {
        OPENAI_API_KEY: "test-key",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      writeDebugLog: async (_directory, entry) => {
        debugLogs.push(entry);
      },
      createStorageClient: () => client
    });

    expect(response.status).toBe(200);
    expect(editForm?.get("model")).toBe("gpt-image-2");
    expect(editForm?.get("quality")).toBe("medium");
    expect(editForm?.getAll("image[]")).toHaveLength(1);
    const prompt = String(editForm?.get("prompt"));
    expect(prompt).toBe("Increase whitespace around the CTA.");
    expect(prompt).not.toContain(requestBody.brief);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("/v1/responses")
      )
    ).toBe(false);
    expect(uploads).toEqual([
      {
        bucket: "creative-assets",
        path: "flora/run-1/outputs/hook-1-v2.png"
      }
    ]);
    expect(debugLogs).toEqual([
      expect.objectContaining({
        directionId: "hook-1",
        request: expect.objectContaining({
          endpoint: "/v1/images/edits",
          multipartFields: expect.objectContaining({ quality: "medium" })
        })
      }),
      expect.objectContaining({
        kind: "image-output",
        directionId: "hook-1"
      })
    ]);
  });

  it("revises an Album master with only the user instruction and selected source", async () => {
    const masterImage = await albumMasterPng();
    let editForm: FormData | undefined;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/auth/v1/user")) {
        return new Response(JSON.stringify({ email: "team@convertcake.com" }), {
          status: 200
        });
      }
      if (href === "https://example.com/album-master.png") {
        return new Response(Uint8Array.from(masterImage), {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
      if (href.includes("/v1/images/edits")) {
        editForm = init?.body as FormData;
        return new Response(
          JSON.stringify({ data: [{ b64_json: masterImage.toString("base64") }] }),
          { status: 200 }
        );
      }
      if (href.includes("/v1/responses")) {
        throw new Error("Album revision must not invoke a prompt agent.");
      }
      throw new Error(`Unexpected fetch: ${href}`);
    });
    const request = new Request("https://moons.local/api/artwork-generation", {
      method: "POST",
      headers: { authorization: "Bearer user-token" },
      body: JSON.stringify({
        requestType: "artwork-revision",
        model: "gpt-image-2",
        clientId: "flora",
        runId: "run-1",
        outputId: "hook-1-album-1-v1",
        directionId: "hook-1",
        assetVersion: 2,
        format: "Album post",
        sourceImageUrl: "https://example.com/album-master.png",
        instructions: "Change only the cover background to blue.",
        album: {
          format: "three-horizontal",
          outputIds: [
            "hook-1-album-1-v1",
            "hook-1-album-2-v1",
            "hook-1-album-3-v1"
          ]
        },
        output: { size: "1024x1024", format: "png" }
      })
    });
    const { client, uploads } = fakeStorage();

    const response = await handleArtworkGenerationRequest({
      request,
      env: {
        OPENAI_API_KEY: "test-key",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      writeDebugLog: async () => undefined,
      createStorageClient: () => client
    });
    const payload = (await response.json()) as { outputs: unknown[] };

    expect(response.status).toBe(200);
    expect(String(editForm?.get("prompt"))).toBe(
      "Change only the cover background to blue."
    );
    expect(editForm?.getAll("image[]")).toHaveLength(1);
    expect(payload.outputs).toHaveLength(3);
    expect(uploads).toHaveLength(4);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("/v1/responses")
      )
    ).toBe(false);
  });

  it("generates and uploads artwork for each selected hook", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/auth/v1/user")) {
        return new Response(
          JSON.stringify({ email: "team@convertcake.com" }),
          { status: 200 }
        );
      }
      if (href.includes("/v1/images/generations")) {
        return new Response(
          JSON.stringify({
            data: [{ b64_json: Buffer.from("fake-png-bytes").toString("base64") }]
          }),
          { status: 200 }
        );
      }
      if (href.includes("/v1/responses")) {
        return standardAgentResponse(init);
      }
      throw new Error(`Unexpected fetch: ${href}`);
    });

    const { client, uploads } = fakeStorage();
    const debugLogs: unknown[] = [];
    const debugAssets: { filename: string; bytes: Buffer }[] = [];
    const upsertCandidates = vi.fn(async () => undefined);

    const response = await handleArtworkGenerationRequest({
      request: buildRequest({ authorization: "Bearer user-token" }),
      env: {
        OPENAI_API_KEY: "test-key",
        ARTWORK_GENERATION_DEBUG_LOG_DIR: "logs/artwork-generation",
        CREATIVE_LEARNING_CAPTURE_ENABLED: "true",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      writeDebugLog: async (_directory, entry, assets) => {
        debugLogs.push(entry);
        debugAssets.push(...(assets ?? []));
      },
      createStorageClient: () => client,
      createLearningCandidateStore: () => ({ upsertCandidates })
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      outputs: Array<Record<string, unknown>>;
    };

    expect(payload.outputs).toHaveLength(1);
    expect(payload.outputs[0]).toMatchObject({
      directionId: "hook-1",
      format: "1:1 Static",
      status: "ready",
      clientStatus: "queued",
      assetBucket: "creative-assets",
      provider: "openai",
      model: "gpt-image-2"
    });
    expect(payload.outputs[0]?.assetUrl).toContain("creative-assets");
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.bucket).toBe("creative-assets");
    expect(uploads[0]?.path).toContain("flora/run-1/outputs/hook-1-v1.png");
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("/v1/responses")
      )
    ).toBe(true);
    expect(debugLogs).toEqual([
      expect.objectContaining({
        kind: "image-prompt-agent",
        model: "gpt-5.6-sol",
        runId: "run-1",
        directionId: "hook-1",
        stage: "campaign-input-preflight"
      }),
      expect.objectContaining({
        model: "gpt-image-2",
        runId: "run-1",
        directionId: "hook-1",
        request: expect.objectContaining({
          endpoint: "/v1/images/generations",
          body: expect.objectContaining({
            model: "gpt-image-2",
            prompt: expect.stringContaining(
              "สร้างภาพโฆษณาที่สมบูรณ์จาก Campaign Input"
            ),
            size: "1024x1024"
          })
        })
      }),
      expect.objectContaining({
        kind: "image-output",
        model: "gpt-image-2",
        runId: "run-1",
        directionId: "hook-1",
        response: expect.objectContaining({
          mimeType: "image/png",
          bytes: Buffer.from("fake-png-bytes").length,
          localFile: expect.stringMatching(/-output\.png$/),
          assetBucket: "creative-assets",
          assetStoragePath: "flora/run-1/outputs/hook-1-v1.png"
        })
      })
    ]);
    expect(JSON.stringify(debugLogs)).toContain(
      "AUTHORITATIVE PREFLIGHTED CAMPAIGN INPUT"
    );
    expect(JSON.stringify(debugLogs)).toContain(
      "Flowers that make the room feel softer"
    );
    expect(debugAssets).toEqual([
      expect.objectContaining({
        filename: expect.stringMatching(/-output\.png$/),
        bytes: Buffer.from("fake-png-bytes")
      })
    ]);
    expect(upsertCandidates).toHaveBeenCalledWith([
      expect.objectContaining({
        client_id: "flora",
        workspace_run_id: "run-1",
        direction_id: "hook-1",
        output_id: "hook-1-v1",
        hook_text: "Flowers that make the room feel softer",
        asset_bucket: "creative-assets",
        asset_storage_path: "flora/run-1/outputs/hook-1-v1.png"
      })
    ]);
    expect(JSON.stringify(debugLogs)).not.toContain("test-key");
    expect(JSON.stringify(debugLogs)).not.toContain("Authorization");
  });

  it("uses the requested output size and passes the matching canvas ratio directly to GPT Image 2", async () => {
    const imageBodies: unknown[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/auth/v1/user")) {
        return new Response(
          JSON.stringify({ email: "team@convertcake.com" }),
          { status: 200 }
        );
      }
      if (href.includes("/v1/images/generations")) {
        imageBodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            data: [{ b64_json: Buffer.from("fake-png-bytes").toString("base64") }]
          }),
          { status: 200 }
        );
      }
      if (href.includes("/v1/responses")) {
        return standardAgentResponse(init);
      }
      throw new Error(`Unexpected fetch: ${href}`);
    });

    const { client } = fakeStorage();
    const response = await handleArtworkGenerationRequest({
      request: new Request("https://moons.local/api/artwork-generation", {
        method: "POST",
        headers: { authorization: "Bearer user-token" },
        body: JSON.stringify({
          ...requestBody,
          output: { size: "3840x2160", format: "png" }
        })
      }),
      env: {
        OPENAI_API_KEY: "test-key",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      createStorageClient: () => client
    });

    expect(response.status).toBe(200);
    expect(imageBodies[0]).toMatchObject({
      size: "3840x2160",
      prompt: expect.stringContaining('"ratio": "16:9"')
    });
  });

  it("generates a three-panel master and keeps both the master and adaptive crops", async () => {
    const imageBodies: Record<string, unknown>[] = [];
    const uploaded: { path: string; body: Buffer }[] = [];
    const masterImage = await albumMasterPng();
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/auth/v1/user")) {
        return new Response(JSON.stringify({ email: "team@convertcake.com" }), {
          status: 200
        });
      }
      if (href.includes("/v1/responses")) {
        return standardAgentResponse(init);
      }
      if (href.includes("/v1/images/generations")) {
        imageBodies.push(
          JSON.parse(String(init?.body)) as Record<string, unknown>
        );
        return new Response(
          JSON.stringify({
            data: [
              {
                b64_json: Buffer.from(
                  masterImage
                ).toString("base64")
              }
            ]
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected fetch: ${href}`);
    });
    const { client } = fakeStorage();
    client.storage.from = () => ({
      upload: async (path: string, body: Buffer) => {
        uploaded.push({ path, body });
        return { error: null };
      },
      createSignedUrl: async (path: string) => ({
        data: { signedUrl: `https://example.com/${path}` },
        error: null
      }),
      download: async () => ({ data: null, error: { message: "Not found" } })
    });

    const response = await handleArtworkGenerationRequest({
      request: new Request("https://moons.local/api/artwork-generation", {
        method: "POST",
        headers: { authorization: "Bearer user-token" },
        body: JSON.stringify({
          ...requestBody,
          service: "album-post",
          selectedHooks: [
            {
              ...requestBody.selectedHooks[0],
              formatBeats: ["Hook", "Proof", "Offer"]
            }
          ]
        })
      }),
      env: {
        OPENAI_API_KEY: "test-key",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      createStorageClient: () => client
    });

    expect(response.status, await response.clone().text()).toBe(200);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("/v1/responses")
      )
    ).toBe(true);
    expect(imageBodies).toHaveLength(1);
    expect(imageBodies[0]?.size).toBe("2048x2048");
    expect(imageBodies[0]?.prompt).toContain("ALBUM MASTER GRID");
    expect(imageBodies[0]?.prompt).not.toContain("never a combined master");
    expect(imageBodies[0]?.prompt).toContain(
      "horizontal cover occupying the full top half"
    );
    const payload = (await response.json()) as {
      outputs: {
        id: string;
        format: string;
        assetStoragePath: string;
        albumMasterAssetUrl?: string;
        albumMasterAssetStoragePath?: string;
      }[];
    };
    expect(payload.outputs.map((output) => output.id)).toEqual([
      "hook-1-album-1-v1",
      "hook-1-album-2-v1",
      "hook-1-album-3-v1"
    ]);
    expect(payload.outputs.every((output) => output.format === "Album post")).toBe(
      true
    );
    expect(uploaded.map(({ path }) => path)).toEqual([
      "flora/run-1/outputs/hook-1-album-master-v1.png",
      "flora/run-1/outputs/hook-1-album-1-v1.png",
      "flora/run-1/outputs/hook-1-album-2-v1.png",
      "flora/run-1/outputs/hook-1-album-3-v1.png"
    ]);
    expect(
      payload.outputs.every(
        (output) =>
          output.albumMasterAssetStoragePath ===
            "flora/run-1/outputs/hook-1-album-master-v1.png" &&
          output.albumMasterAssetUrl?.includes("hook-1-album-master-v1.png")
      )
    ).toBe(true);
  });

  it("normalizes a shifted four-grid master before saving its panels", async () => {
    const shiftedMaster = await fourGridMasterPng({
      vertical: 256,
      horizontal: 280
    });
    const uploaded: { path: string; body: Buffer }[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/auth/v1/user")) {
        return new Response(JSON.stringify({ email: "team@convertcake.com" }), {
          status: 200
        });
      }
      if (href.includes("/v1/responses")) {
        return standardAgentResponse(init);
      }
      if (href.includes("/v1/images/generations")) {
        return new Response(
          JSON.stringify({
            data: [{ b64_json: shiftedMaster.toString("base64") }]
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected fetch: ${href}`);
    });
    const { client } = fakeStorage();
    client.storage.from = () => ({
      upload: async (path: string, body: Buffer) => {
        uploaded.push({ path, body });
        return { error: null };
      },
      createSignedUrl: async (path: string) => ({
        data: { signedUrl: `https://example.com/${path}` },
        error: null
      }),
      download: async () => ({ data: null, error: { message: "Not found" } })
    });

    const response = await handleArtworkGenerationRequest({
      request: new Request("https://moons.local/api/artwork-generation", {
        method: "POST",
        headers: { authorization: "Bearer user-token" },
        body: JSON.stringify({
          ...requestBody,
          service: "album-post",
          albumFormat: "four-grid",
          selectedHooks: [
            {
              ...requestBody.selectedHooks[0],
              albumFormat: "four-grid",
              formatBeats: ["Hook", "Proof", "Offer"]
            }
          ]
        })
      }),
      env: {
        OPENAI_API_KEY: "test-key",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      createStorageClient: () => client
    });

    expect(response.status, await response.clone().text()).toBe(200);
    expect(uploaded.map(({ path }) => path)).toEqual([
      "flora/run-1/outputs/hook-1-album-master-v1.png",
      "flora/run-1/outputs/hook-1-album-1-v1.png",
      "flora/run-1/outputs/hook-1-album-2-v1.png",
      "flora/run-1/outputs/hook-1-album-3-v1.png",
      "flora/run-1/outputs/hook-1-album-4-v1.png"
    ]);
    await expect(
      inspectFourGridMasterAlignment(uploaded[0]!.body)
    ).resolves.toMatchObject({ valid: true });
    await Promise.all(
      uploaded.slice(1).map(async ({ body }) => {
        const metadata = await sharp(body).metadata();
        expect(metadata).toMatchObject({ width: 960, height: 960 });
      })
    );
  });

  it("persists a normalized four-grid master without an image repair", async () => {
    const shiftedMaster = await fourGridMasterPng({
      vertical: 256,
      horizontal: 280
    });
    const { client, uploads } = fakeStorage();
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/auth/v1/user")) {
        return new Response(JSON.stringify({ email: "team@convertcake.com" }), {
          status: 200
        });
      }
      if (href.includes("/v1/responses")) {
        return standardAgentResponse(init);
      }
      if (
        href.includes("/v1/images/generations") ||
        href.includes("/v1/images/edits")
      ) {
        return new Response(
          JSON.stringify({
            data: [{ b64_json: shiftedMaster.toString("base64") }]
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected fetch: ${href}`);
    });

    const response = await handleArtworkGenerationRequest({
      request: new Request("https://moons.local/api/artwork-generation", {
        method: "POST",
        headers: { authorization: "Bearer user-token" },
        body: JSON.stringify({
          ...requestBody,
          service: "album-post",
          albumFormat: "four-grid",
          selectedHooks: [
            {
              ...requestBody.selectedHooks[0],
              albumFormat: "four-grid",
              formatBeats: ["Hook", "Proof", "Offer"]
            }
          ]
        })
      }),
      env: {
        OPENAI_API_KEY: "test-key",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      createStorageClient: () => client
    });

    expect(response.status, await response.clone().text()).toBe(200);
    expect(uploads).toHaveLength(5);
  });

  it("uses the selected four-panel master layout in Design System mode", async () => {
    const imageBodies: Record<string, unknown>[] = [];
    const uploaded: { path: string; body: Buffer }[] = [];
    const masterImage = await albumMasterPng();
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/auth/v1/user")) {
        return new Response(JSON.stringify({ email: "team@convertcake.com" }), {
          status: 200
        });
      }
      if (href.includes("/v1/responses")) {
        return responseForArtworkAgentRequest(init);
      }
      if (href.includes("/v1/images/generations")) {
        imageBodies.push(
          JSON.parse(String(init?.body)) as Record<string, unknown>
        );
        return new Response(
          JSON.stringify({
            data: [
              {
                b64_json: Buffer.from(
                  masterImage
                ).toString("base64")
              }
            ]
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected fetch: ${href}`);
    });
    const { client } = fakeStorage();
    client.storage.from = () => ({
      upload: async (path: string, body: Buffer) => {
        uploaded.push({ path, body });
        return { error: null };
      },
      createSignedUrl: async (path: string) => ({
        data: { signedUrl: `https://example.com/${path}` },
        error: null
      }),
      download: async () => ({ data: null, error: { message: "Not found" } })
    });

    const response = await handleArtworkGenerationRequest({
      request: new Request("https://moons.local/api/artwork-generation", {
        method: "POST",
        headers: { authorization: "Bearer user-token" },
        body: JSON.stringify({
          ...requestBody,
          artworkMode: "design-system",
          service: "album-post",
          albumFormat: "auto",
          selectedHooks: [
            {
              ...requestBody.selectedHooks[0],
              albumFormat: "four-vertical",
              formatBeats: ["เปิดปัญหา", "อธิบายหลักฐาน", "ปิดด้วยข้อเสนอ"]
            }
          ]
        })
      }),
      env: {
        OPENAI_API_KEY: "test-key",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      createStorageClient: () => client
    });

    expect(response.status, await response.clone().text()).toBe(200);
    expect(imageBodies).toHaveLength(1);
    expect(imageBodies[0]?.size).toBe("2048x2048");
    expect(imageBodies[0]?.prompt).toContain(
      "GPT IMAGE 2 — ADAPTIVE FINAL ART DIRECTOR V6.3"
    );
    expect(imageBodies[0]?.prompt).toContain("Album master rules:");
    expect(imageBodies[0]?.prompt).toContain(
      "Use the selected four-vertical structure with 4 clearly separated panels."
    );
    expect(imageBodies[0]?.prompt).not.toContain("Static artwork rules:");
    expect(imageBodies[0]?.prompt).not.toContain("{{");
    expect(imageBodies[0]?.prompt).toContain("ALBUM MASTER GRID");
    expect(imageBodies[0]?.prompt).toContain("เปิดปัญหา");
    expect(imageBodies[0]?.prompt).toContain("อธิบายหลักฐาน");
    expect(imageBodies[0]?.prompt).toContain("ปิดด้วยข้อเสนอ");
    expect(imageBodies[0]?.prompt).toContain(
      "large vertical cover occupying the full left two-thirds"
    );
    expect(imageBodies[0]?.prompt).toContain(
      "Do not render sequence labels, page numbers, step numbers, or decorative numerals"
    );
    expect(imageBodies[0]?.prompt).toContain(
      "ONE CAMPAIGN WORLD IS MANDATORY"
    );
    expect(imageBodies[0]?.prompt).toContain(
      "render exactly one CTA across the entire master"
    );
    expect(imageBodies[0]?.prompt).toContain(
      "located only in the closing supporting area"
    );
    expect(imageBodies[0]?.prompt).toContain(
      "the CTA text must appear once, not twice"
    );
    expect(imageBodies[0]?.prompt).toContain(
      "not a collage of separate mini-posters"
    );
    expect(imageBodies[0]?.prompt).not.toContain("Panel 1");
    expect(imageBodies[0]?.prompt).not.toContain("Panel 2");
    expect(imageBodies[0]?.prompt).not.toContain("Panel 3");
    expect(imageBodies[0]?.prompt).not.toContain("Panel 4");
    const payload = (await response.json()) as {
      outputs: { id: string; format: string }[];
    };
    expect(payload.outputs.map((output) => output.id)).toEqual([
      "hook-1-album-1-v1",
      "hook-1-album-2-v1",
      "hook-1-album-3-v1",
      "hook-1-album-4-v1"
    ]);
    expect(uploaded.map(({ path }) => path)).toEqual([
      "flora/run-1/outputs/hook-1-album-master-v1.png",
      "flora/run-1/outputs/hook-1-album-1-v1.png",
      "flora/run-1/outputs/hook-1-album-2-v1.png",
      "flora/run-1/outputs/hook-1-album-3-v1.png",
      "flora/run-1/outputs/hook-1-album-4-v1.png"
    ]);
  });

  it("keeps the final album prompt below the provider limit after adding master instructions", async () => {
    const imageBodies: Array<{ prompt: string }> = [];
    const masterImage = await albumMasterPng();
    const fetchMock = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url);
        if (href.includes("/auth/v1/user")) {
          return new Response(
            JSON.stringify({ email: "team@convertcake.com" }),
            { status: 200 }
          );
        }
        if (href.includes("/v1/responses")) {
          return responseForArtworkAgentRequest(init);
        }
        if (href.includes("/v1/images/generations")) {
          imageBodies.push(
            JSON.parse(String(init?.body)) as { prompt: string }
          );
          return new Response(
            JSON.stringify({
              data: [{ b64_json: masterImage.toString("base64") }]
            }),
            { status: 200 }
          );
        }
        throw new Error(`Unexpected fetch: ${href}`);
      }
    );
    const { client } = fakeStorage();
    const longText = "Detailed brand guideline ".repeat(240);

    const response = await handleArtworkGenerationRequest({
      request: new Request("https://moons.local/api/artwork-generation", {
        method: "POST",
        headers: { authorization: "Bearer user-token" },
        body: JSON.stringify({
          ...requestBody,
          artworkMode: "design-system",
          service: "album-post",
          albumFormat: "four-vertical",
          brandMemory: {
            working: Array.from({ length: 8 }, () => longText),
            avoid: Array.from({ length: 8 }, () => longText)
          },
          brandLibrary: {
            brand: Array.from({ length: 6 }, (_, index) => ({
              title: `Brand item ${index + 1}`,
              description: longText
            })),
            products: Array.from({ length: 8 }, (_, index) => ({
              title: `Product ${index + 1}`,
              description: longText
            })),
            docs: Array.from({ length: 3 }, () => ({
              title: "Brand guideline",
              description: longText
            })),
            refs: Array.from({ length: 6 }, (_, index) => ({
              title: `Reference ${index + 1}`,
              description: longText
            }))
          },
          selectedHooks: [
            {
              ...requestBody.selectedHooks[0],
              albumFormat: "four-vertical",
              formatBeats: ["Hook", "Proof", "Offer"]
            }
          ]
        })
      }),
      env: {
        OPENAI_API_KEY: "test-key",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      createStorageClient: () => client
    });

    expect(response.status, await response.clone().text()).toBe(200);
    expect(imageBodies).toHaveLength(1);
    expect(imageBodies[0]!.prompt.length).toBeLessThanOrEqual(31_500);
    expect(imageBodies[0]!.prompt).toContain("ALBUM MASTER GRID");
    expect(imageBodies[0]!.prompt).toContain(
      requestBody.selectedHooks[0]!.hook
    );
    expect(imageBodies[0]!.prompt).not.toContain("Static artwork rules:");
    expect(imageBodies[0]!.prompt).not.toContain("{{");
  });

  it("generates two selected hooks at a time while preserving their order", async () => {
    let activeGenerations = 0;
    let maximumConcurrentGenerations = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/auth/v1/user")) {
        return new Response(JSON.stringify({ email: "team@convertcake.com" }), {
          status: 200
        });
      }
      if (href.includes("/v1/responses")) {
        return standardAgentResponse(init);
      }
      if (href.includes("/v1/images/generations")) {
        activeGenerations += 1;
        maximumConcurrentGenerations = Math.max(
          maximumConcurrentGenerations,
          activeGenerations
        );
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeGenerations -= 1;
        return new Response(
          JSON.stringify({
            data: [{ b64_json: Buffer.from("fake-png-bytes").toString("base64") }]
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected fetch: ${href}`);
    });
    const { client } = fakeStorage();

    const response = await handleArtworkGenerationRequest({
      request: new Request("https://moons.local/api/artwork-generation", {
        method: "POST",
        headers: { authorization: "Bearer user-token" },
        body: JSON.stringify({
          ...requestBody,
          selectedHooks: [
            requestBody.selectedHooks[0],
            { ...requestBody.selectedHooks[0], id: "hook-2" },
            { ...requestBody.selectedHooks[0], id: "hook-3" }
          ]
        })
      }),
      env: {
        OPENAI_API_KEY: "test-key",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      createStorageClient: () => client
    });

    const payload = (await response.json()) as {
      outputs: Array<{ directionId: string }>;
    };
    expect(maximumConcurrentGenerations).toBe(2);
    expect(payload.outputs.map((output) => output.directionId)).toEqual([
      "hook-1",
      "hook-2",
      "hook-3"
    ]);
  });

  it("returns a readable error when OpenAI returns an empty body", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/auth/v1/user")) {
        return new Response(
          JSON.stringify({ email: "team@convertcake.com" }),
          { status: 200 }
        );
      }
      if (href.includes("/v1/responses")) {
        return standardAgentResponse(init);
      }
      return new Response("", { status: 200 });
    });

    const { client } = fakeStorage();

    const response = await handleArtworkGenerationRequest({
      request: buildRequest({ authorization: "Bearer user-token" }),
      env: {
        OPENAI_API_KEY: "test-key",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      createStorageClient: () => client
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "OpenAI image generation returned an empty response body."
    });
  });

  it("attaches Standard references without adding a reference-direction wrapper", async () => {
    const editCalls: { href: string; body: FormData }[] = [];
    const cmykReference = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: { r: 210, g: 160, b: 90 }
      }
    })
      .toColourspace("cmyk")
      .jpeg()
      .toBuffer();
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/auth/v1/user")) {
        return new Response(
          JSON.stringify({ email: "team@convertcake.com" }),
          { status: 200 }
        );
      }
      if (href.includes("/reference.png")) {
        return new Response(cmykReference, {
          status: 200,
          headers: { "content-type": "image/jpeg" }
        });
      }
      if (href.includes("/v1/responses")) {
        return standardAgentResponse(init);
      }
      if (href.includes("/v1/images/edits")) {
        editCalls.push({ href, body: init?.body as FormData });
        return new Response(
          JSON.stringify({
            data: [{ b64_json: Buffer.from("fake-png-bytes").toString("base64") }]
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected fetch: ${href}`);
    });

    const { client, uploads } = fakeStorage();

    const request = new Request("https://moons.local/api/artwork-generation", {
      method: "POST",
      headers: { authorization: "Bearer user-token" },
      body: JSON.stringify({
        ...requestBody,
        referenceImages: [
          {
            kind: "url",
            url: "https://example.com/reference.png",
            label: "Past work style reference — Convert Cake campaign"
          }
        ]
      })
    });

    const response = await handleArtworkGenerationRequest({
      request,
      env: {
        OPENAI_API_KEY: "test-key",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      createStorageClient: () => client
    });

    expect(response.status).toBe(200);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("/v1/responses")
      )
    ).toBe(true);
    expect(editCalls).toHaveLength(1);
    const referenceFile = editCalls[0]?.body.get("image[]") as File;
    expect(referenceFile.type).toBe("image/jpeg");
    expect(editCalls[0]?.body.get("prompt")).not.toContain(
      "CONCEPT ALIGNMENT"
    );
    expect(editCalls[0]?.body.get("prompt")).not.toContain(
      "REFERENCE-INFORMED DESIGN"
    );
    expect(editCalls[0]?.body.get("prompt")).not.toContain(
      "PAST-WORK VISUAL DNA"
    );
    expect(editCalls[0]?.body.get("prompt")).not.toContain(
      "STYLE FIDELITY IS MANDATORY"
    );
    expect(uploads).toHaveLength(1);
  });

  it("uses a private Supabase artwork reference URL in reference-library mode", async () => {
    const strategyAgentBodies: Record<string, unknown>[] = [];
    const promptAgentBodies: Record<string, unknown>[] = [];
    const editCalls: FormData[] = [];
    const debugLogs: unknown[] = [];
    const debugAssets: { filename: string; bytes: Buffer }[] = [];
    const referenceUrl =
      "https://supabase.example.com/storage/v1/object/sign/artwork-reference-library/artworks/aw_elida_jun25_-2.jpg?token=signed";
    const storedReference = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: { r: 210, g: 160, b: 90 }
      }
    })
      .jpeg()
      .toBuffer();
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/auth/v1/user")) {
        return new Response(JSON.stringify({ email: "team@convertcake.com" }), {
          status: 200
        });
      }
      if (href.includes("/v1/responses")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const responseName = (
          body.text as { format?: { name?: string } } | undefined
        )?.format?.name;
        if (responseName === "moons_creative_strategy_enrichment") {
          strategyAgentBodies.push(body);
          return strategyAgentResponse();
        }
        promptAgentBodies.push(body);
        return promptAgentResponse("Reference-informed beauty artwork.");
      }
      if (href.includes("/v1/images/edits")) {
        editCalls.push(init?.body as FormData);
        return new Response(
          JSON.stringify({
            data: [{ b64_json: Buffer.from("fake-png-bytes").toString("base64") }]
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected fetch: ${href}`);
    });
    const { client } = fakeStorage();
    const defaultFrom = client.storage.from.bind(client.storage);
    client.storage.from = (bucket: string) => {
      if (bucket !== "artwork-reference-library") return defaultFrom(bucket);
      return {
        upload: async () => ({ error: null }),
        createSignedUrl: async () => ({
          data: { signedUrl: referenceUrl },
          error: null
        }),
        download: async () => ({
          data: {
            type: "image/jpeg",
            arrayBuffer: async () => storedReference
          } as unknown as Blob,
          error: null
        })
      };
    };

    const response = await handleArtworkGenerationRequest({
      request: new Request("https://moons.local/api/artwork-generation", {
        method: "POST",
        headers: { authorization: "Bearer user-token" },
        body: JSON.stringify({
          ...requestBody,
          artworkMode: "reference-library",
          brand: { ...requestBody.brand, category: "Beauty clinic" },
          brief: "Launch a soft skin clinic promotion."
        })
      }),
      env: {
        OPENAI_API_KEY: "test-key",
        ARTWORK_GENERATION_DEBUG_LOG_DIR: "logs/artwork-generation",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      writeDebugLog: async (_directory, entry, assets) => {
        debugLogs.push(entry);
        debugAssets.push(...(assets ?? []));
      },
      createStorageClient: () => client
    });

    expect(response.status, await response.clone().text()).toBe(200);
    expect(strategyAgentBodies).toHaveLength(1);
    expect(strategyAgentBodies[0]?.model).toBe("gpt-5.6-luna");
    const content = (promptAgentBodies[0]?.input as {
      content: { type: string; image_url?: string }[];
    }[])[0]?.content;
    expect(content?.filter((item) => item.type === "input_image")).toEqual([
      {
        type: "input_image",
        image_url: referenceUrl,
        detail: "high"
      },
      {
        type: "input_image",
        image_url: referenceUrl,
        detail: "high"
      }
    ]);
    expect(editCalls).toHaveLength(1);
    expect(editCalls[0]?.getAll("image[]")).toHaveLength(2);
    const generationPrompt = String(editCalls[0]?.get("prompt"));
    expect(generationPrompt).toContain(
      "Invent a new main visual, visual metaphor"
    );
    expect(generationPrompt).toContain(
      "Study the attached Creative Compass artwork references directly"
    );
    expect(generationPrompt).toContain("STYLE FIDELITY IS MANDATORY");
    expect(generationPrompt).toContain(
      "same art director and design system created a new campaign for this idea"
    );
    expect(generationPrompt).toContain(
      "coherent in perspective, scale, lighting, shadows, color grade, depth, and material treatment"
    );
    expect(generationPrompt).toContain(
      "Protect 30–40% genuine low-detail negative space"
    );
    expect(generationPrompt).toContain(
      "keep the main visual near 30–40% of the canvas and below half"
    );
    expect(generationPrompt).toContain("Image 1: primary artwork reference");
    expect(generationPrompt).toContain("Image 2: secondary artwork reference");
    expect(generationPrompt).not.toContain("mode standard_commercial");
    expect(debugLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "creative-strategy-agent",
          model: "gpt-5.6-luna",
          status: "succeeded",
          response: expect.objectContaining({
            commercialStyle: "lifestyle"
          })
        }),
        expect.objectContaining({
          runId: "run-1",
          directionId: "hook-1",
          request: expect.objectContaining({
            endpoint: "/v1/images/edits",
            multipartFields: expect.objectContaining({
              prompt: expect.stringContaining(
                "Study the attached Creative Compass artwork references directly"
              ),
              images: [
                {
                  label: "Creative Compass artwork reference — primary",
                  mimeType: "image/jpeg",
                  bytes: expect.any(Number)
                },
                {
                  label: "Creative Compass artwork reference — secondary",
                  mimeType: "image/jpeg",
                  bytes: expect.any(Number)
                }
              ]
            })
          })
        }),
        expect.objectContaining({
          kind: "image-output",
          response: expect.objectContaining({
            localFile: expect.stringMatching(/-output\.png$/)
          })
        })
      ])
    );
    expect(debugAssets).toEqual([
      expect.objectContaining({
        filename: expect.stringMatching(/-output\.png$/),
        bytes: Buffer.from("fake-png-bytes")
      })
    ]);
  });

  it("recovers an expired Supabase signed reference URL through storage", async () => {
    const editCalls: FormData[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/auth/v1/user")) {
        return new Response(JSON.stringify({ email: "team@convertcake.com" }), {
          status: 200
        });
      }
      if (href.includes("/storage/v1/object/sign/brand-assets/")) {
        return new Response("Expired signature", { status: 400 });
      }
      if (href.includes("/v1/responses")) {
        return promptAgentResponse();
      }
      if (href.includes("/v1/images/edits")) {
        editCalls.push(init?.body as FormData);
        return new Response(
          JSON.stringify({
            data: [{ b64_json: Buffer.from("fake-png-bytes").toString("base64") }]
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected fetch: ${href}`);
    });
    const { client } = fakeStorage();
    client.storage.from = () => ({
      upload: async () => ({ error: null }),
      createSignedUrl: async () => ({
        data: { signedUrl: "https://supabase.example.com/signed.png" },
        error: null
      }),
      download: async () => ({
        data: {
          type: "image/png",
          arrayBuffer: async () => Buffer.from("recovered-image")
        } as unknown as Blob,
        error: null
      })
    });

    const response = await handleArtworkGenerationRequest({
      request: new Request("https://moons.local/api/artwork-generation", {
        method: "POST",
        headers: { authorization: "Bearer user-token" },
        body: JSON.stringify({
          ...requestBody,
          referenceImages: [
            {
              kind: "url",
              label: "Convert Cake reference",
              url: "https://supabase.example.com/storage/v1/object/sign/brand-assets/client/ref.png?token=expired"
            }
          ]
        })
      }),
      env: {
        OPENAI_API_KEY: "test-key",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      createStorageClient: () => client
    });

    expect(response.status).toBe(200);
    expect(editCalls).toHaveLength(1);
    expect((editCalls[0]?.get("image[]") as File).type).toBe("image/png");
  });

  it("preflights Campaign Input with Sol, then sends agent_image.md plus the cleaned input to GPT Image 2", async () => {
    const generationCalls: string[] = [];
    const preflightCalls: Array<{ model: string; inputText: string }> = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/auth/v1/user")) {
        return new Response(
          JSON.stringify({ email: "team@convertcake.com" }),
          { status: 200 }
        );
      }
      if (href.includes("/v1/images/generations")) {
        const body = JSON.parse(String(init?.body)) as { prompt: string };
        generationCalls.push(body.prompt);
        return new Response(
          JSON.stringify({
            data: [{ b64_json: Buffer.from("fake-png-bytes").toString("base64") }]
          }),
          { status: 200 }
        );
      }
      if (href.includes("/v1/responses")) {
        const body = JSON.parse(String(init?.body)) as {
          model: string;
          input?: { content?: { type?: string; text?: string }[] }[];
          text?: { format?: { name?: string } };
        };
        if (body.text?.format?.name === "moons_campaign_input_preflight") {
          preflightCalls.push({
            model: body.model,
            inputText:
              body.input?.[0]?.content?.find(
                (item) => item.type === "input_text"
              )?.text ?? ""
          });
        }
        return standardAgentResponse(init);
      }
      throw new Error(`Unexpected fetch: ${href}`);
    });

    const { client } = fakeStorage();

    const response = await handleArtworkGenerationRequest({
      request: buildRequest({ authorization: "Bearer user-token" }),
      env: {
        OPENAI_API_KEY: "test-key",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      createStorageClient: () => client
    });

    expect(response.status).toBe(200);
    expect(preflightCalls).toHaveLength(1);
    expect(preflightCalls[0]?.model).toBe("gpt-5.6-sol");
    expect(preflightCalls[0]?.inputText).toContain("Campaign Input Preflight");
    expect(preflightCalls[0]?.inputText).toContain(
      '"headline": "Flowers that make the room feel softer"'
    );
    expect(preflightCalls[0]?.inputText).not.toContain(
      "สร้างภาพโฆษณาที่สมบูรณ์"
    );
    expect(generationCalls).toHaveLength(1);
    expect(generationCalls[0]).toContain(
      "สร้างภาพโฆษณาที่สมบูรณ์จาก Campaign Input คำสั่งของผู้ใช้ และรูปภาพที่แนบมา"
    );
    expect(generationCalls[0]).toContain(
      "AUTHORITATIVE PREFLIGHTED CAMPAIGN INPUT"
    );
    expect(generationCalls[0]).toContain(
      '"headline": "Flowers that make the room feel softer"'
    );
    expect(generationCalls[0]).not.toContain("CAMPAIGN INPUT TO PREFLIGHT");
  });

  it("uses Terra on OpenAI for Standard preflight even when Claude is selected elsewhere", async () => {
    const openRouterCalls: string[] = [];
    const preflightCalls: Array<{
      model: string;
      authorization: string | null;
    }> = [];
    const imageAuthorizations: Array<string | null> = [];
    const visualQcAuthorizations: Array<string | null> = [];
    const fetchMock = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url);
        if (href.includes("/auth/v1/user")) {
          return new Response(
            JSON.stringify({ email: "team@convertcake.com" }),
            { status: 200 }
          );
        }
        if (href === "https://openrouter.ai/api/v1/responses") {
          openRouterCalls.push(href);
          throw new Error("Standard must not use OpenRouter.");
        }
        if (href === "https://api.openai.com/v1/responses") {
          const body = JSON.parse(String(init?.body)) as {
            model: string;
            text?: { format?: { name?: string } };
          };
          const authorization = new Headers(init?.headers).get("Authorization");
          if (body.text?.format?.name === "moons_campaign_input_preflight") {
            preflightCalls.push({ model: body.model, authorization });
          } else {
            visualQcAuthorizations.push(authorization);
          }
          return standardAgentResponse(init);
        }
        if (href.includes("/v1/images/generations")) {
          imageAuthorizations.push(
            new Headers(init?.headers).get("Authorization")
          );
          return new Response(
            JSON.stringify({
              data: [
                { b64_json: Buffer.from("fake-png-bytes").toString("base64") }
              ]
            }),
            { status: 200 }
          );
        }
        throw new Error(`Unexpected fetch: ${href}`);
      }
    );
    const { client } = fakeStorage();

    const response = await handleArtworkGenerationRequest({
      request: new Request("https://moons.local/api/artwork-generation", {
        method: "POST",
        headers: { authorization: "Bearer user-token" },
        body: JSON.stringify({
          ...requestBody,
          imagePromptModel: "anthropic/claude-sonnet-4.6"
        })
      }),
      env: {
        OPENAI_API_KEY: "openai-image-key",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      createStorageClient: () => client
    });

    expect(response.status).toBe(200);
    expect(openRouterCalls).toEqual([]);
    expect(preflightCalls).toEqual([
      {
        model: "gpt-5.6-sol",
        authorization: "Bearer openai-image-key"
      }
    ]);
    expect(imageAuthorizations).toEqual(["Bearer openai-image-key"]);
    expect(visualQcAuthorizations).toEqual([]);
  });

  it("requires an OpenRouter key only when its prompt model is selected", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/auth/v1/user")) {
        return new Response(
          JSON.stringify({ email: "team@convertcake.com" }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected fetch: ${String(url)}`);
    });

    const response = await handleArtworkGenerationRequest({
      request: new Request("https://moons.local/api/artwork-generation", {
        method: "POST",
        headers: { authorization: "Bearer user-token" },
        body: JSON.stringify({
          ...requestBody,
          artworkMode: "reference-library",
          imagePromptModel: "anthropic/claude-sonnet-4.6"
        })
      }),
      env: {
        OPENAI_API_KEY: "openai-image-key",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "OPENROUTER_API_KEY is required."
    });
  });

  it("compiles a sparse, service-relevant Campaign Context for budget allocation", async () => {
    const prompt = await captureDesignSystemGenerationPrompt({
      brand: {
        id: "convert-cake",
        name: "Convert Cake Ads",
        category: "Performance Marketing Agency",
        personality: [],
        colors: ["#1D48F3", "#000E3F", "#FFFFFF"]
      },
      brief:
        "Objective: Create Meta performance creatives that make the product benefit instantly clear. Message priority: Lead with a recognizable tension, prove the product difference, and end with a low-friction action. Creative guardrails: Keep the first frame bold, reduce decorative copy, show the product early.",
      selectedHooks: [
        {
          ...requestBody.selectedHooks[0],
          hook: "ยอดขายนิ่ง อาจไม่ใช่เพราะงบน้อย",
          concept:
            "ชี้ให้เห็นว่า Budget, Platform และวัตถุประสงค์ที่ไม่ตรงกันอาจทำให้พลาดโอกาส",
          cta: "ขอวางแผนงบ",
          supportingPoints: [
            "วิเคราะห์ Budget Allocation ตาม KPI",
            "พิจารณาความเหมาะสมของ Platform และเป้าหมายแคมเปญ",
            "ตรวจจุดรั่วระหว่าง Prospecting และ Retargeting"
          ]
        }
      ],
      referenceImages: [
        {
          kind: "url",
          url: "https://example.com/logo.png",
          label: "Supporting reference · Logo · Logo"
        }
      ],
      brandLibrary: {
        brand: [],
        products: [
          {
            id: "ai-seo",
            title: "AI SEO / AEO / GEO",
            description: "Help B2B brands appear in AI search answers."
          },
          {
            id: "performance",
            title: "Performance Marketing Agency",
            description:
              "Plan Budget Allocation, Platform mix, campaign objectives, and performance measurement."
          },
          {
            id: "kol",
            title: "KOL campaign support",
            description: "Influencer selection and campaign consulting."
          }
        ],
        docs: [],
        refs: []
      }
    });
    expect(prompt).toContain(
      "make the core offer or value proposition credible"
    );
    expect(prompt).toContain(
      "make the core offer or value proposition visually clear early"
    );
    expect(prompt).not.toContain("prove the product difference");
    expect(prompt).not.toContain("show the product early");
    expect(prompt).toContain("Performance Marketing Agency");
    expect(prompt).not.toContain("AI SEO / AEO / GEO");
    expect(prompt).not.toContain("KOL campaign support");
    expect(prompt).toContain("วิเคราะห์ Budget Allocation ตาม KPI");
    expect(prompt).toContain(
      "พิจารณาความเหมาะสมของ Platform และเป้าหมายแคมเปญ"
    );
    expect(prompt).not.toContain(
      "ตรวจจุดรั่วระหว่าง Prospecting และ Retargeting"
    );
    expect(prompt).toContain("Supporting content is optional");
    expect(prompt).not.toContain("{{");
  });

  it("runs V6 upstream with the V6.2 Judgment final prompt in design-system mode", async () => {
    const editCalls: FormData[] = [];
    const strategyCalls: Record<string, unknown>[] = [];
    const oversizedContext = "Brand context detail ".repeat(500);
    const artworkBriefTail = "ARTWORK-BRIEF-END";
    const completeArtworkBrief = [
      "MANDATORY ARTWORK BRIEF — USER-SUPPLIED FINAL-ART REQUIREMENT",
      "Follow this instruction in the generated artwork. It overrides optional creative suggestions but does not authorize changing locked campaign facts, exact copy, or official assets.",
      `${"A".repeat(2_980)}\n${artworkBriefTail}`
    ].join("\n");
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/auth/v1/user")) {
        return new Response(
          JSON.stringify({ email: "team@convertcake.com" }),
          { status: 200 }
        );
      }
      if (href === "https://example.com/logo.png") {
        return new Response(Buffer.from("official-logo"), {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
      if (href.includes("/v1/responses")) {
        strategyCalls.push(
          JSON.parse(String(init?.body)) as Record<string, unknown>
        );
        const body = JSON.parse(String(init?.body)) as {
          text?: { format?: { name?: string } };
        };
        return body.text?.format?.name === "moons_creative_visual_concept"
          ? creativeGraphicDesignerResponse()
          : strategyAgentResponse({
              offer: {
                text: "Same-day delivery in Bangkok",
                evidenceId: "supporting-point:0",
                source: "verified"
              },
              proof: [
                {
                  text: "Hand-arranged seasonal stems",
                  evidenceId: "supporting-point:1",
                  source: "verified"
                }
              ],
              evidenceStatus: "verified",
              missingEvidence: []
            });
      }
      if (href.includes("/v1/images/edits")) {
        editCalls.push(init?.body as FormData);
        return new Response(
          JSON.stringify({
            data: [{ b64_json: Buffer.from("fake-png-bytes").toString("base64") }]
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected fetch: ${href}`);
    });

    const { client } = fakeStorage();
    const response = await handleArtworkGenerationRequest({
      request: new Request("https://moons.local/api/artwork-generation", {
        method: "POST",
        headers: { authorization: "Bearer user-token" },
        body: JSON.stringify({
          ...requestBody,
          artworkMode: "design-system",
          imagePromptModel: "anthropic/claude-sonnet-4.6",
          textInputs: [
            "Earlier correction that should be superseded.",
            completeArtworkBrief
          ],
          selectedHooks: [
            {
              ...requestBody.selectedHooks[0],
              supportingPoints: [
                "Same-day delivery in Bangkok",
                "Hand-arranged seasonal stems",
                "Unselected third supporting point"
              ]
            }
          ],
          brandMemory: {
            working: [oversizedContext],
            avoid: [oversizedContext]
          },
          brandLibrary: {
            brand: [
              { title: "Brand system", description: oversizedContext },
              {
                title: "Brand CI / Guideline",
                description:
                  "DERIVED STALE GUIDELINE: use a different typeface and ignore clear space."
              }
            ],
            products: [
              {
                id: "flower-delivery",
                title: "Flower delivery service",
                description:
                  "Bouquet ordering and same-day flower delivery in Bangkok."
              },
              {
                id: "ai-seo",
                title: "AI SEO / AEO / GEO",
                description: "Help B2B brands appear in AI search answers."
              },
              {
                id: "kol",
                title: "KOL campaign support",
                description: "Influencer selection and campaign consulting."
              }
            ],
            docs: [
              {
                title: "Brand guideline",
                description:
                  "EDITABLE SOURCE GUIDELINE. Typography: use Söhne Breit for headlines. Logo: preserve 48 px clear space. Imagery: warm natural daylight; never use floating 3D objects."
              },
              { title: "Campaign brief", description: oversizedContext }
            ],
            refs: [{ title: "Creative learning", description: oversizedContext }]
          },
          referenceImages: [
            {
              kind: "url",
              url: "https://example.com/logo.png",
              label: "Primary reference · Logo · Latest logo"
            },
            {
              kind: "url",
              url: "https://example.com/logo.png",
              label: "Supporting reference · Style · Workshop CTA"
            }
          ]
        })
      }),
      env: {
        OPENAI_API_KEY: "test-key",
        OPENROUTER_API_KEY: "openrouter-test-key",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      createStorageClient: () => client
    });

    expect(response.status).toBe(200);
    expect(editCalls).toHaveLength(1);
    expect(editCalls[0]?.getAll("image[]")).toHaveLength(2);
    expect(editCalls[0]?.get("quality")).toBe("medium");
    const prompt = String(editCalls[0]?.get("prompt"));
    expect(prompt).toContain(
      "GPT IMAGE 2 — ADAPTIVE FINAL ART DIRECTOR V6.3"
    );
    expect(prompt).toContain(
      "Create one complete, publication-ready advertising artwork"
    );
    expect(prompt).toContain(
      "Choose the visual language that best serves this specific concept"
    );
    expect(prompt).toContain(
      "Explore several substantially different executable approaches"
    );
    expect(prompt).toContain(
      "Choose a coherent spatial system from the concept and references"
    );
    expect(prompt).toContain("information must form");
    expect(prompt).toContain(
      "Use motivated light with coherent direction"
    );
    expect(prompt).toContain(
      "Quiet space may be empty, atmospheric"
    );
    expect(prompt).toContain(
      "Create one unmistakable focal relationship and a deliberate reading order"
    );
    expect(prompt).toContain(
      "the result feels selected by human judgement"
    );
    expect(prompt).toContain("Selling mechanism:\ndesire");
    expect(prompt).toContain(
      "Infer whether human presence materially improves the campaign message"
    );
    expect(prompt).toContain(
      "### Creative provocation"
    );
    expect(prompt).toContain(
      "A bouquet appears to soften the hard geometry of a room"
    );
    expect(prompt).toContain("- Name: Flora Daily");
    expect(prompt).not.toContain("Do not use people, faces, bodies");
    expect(prompt).not.toContain("remain clearly subordinate");
    expect(prompt).toContain(
      "Business problem and communication objective:\nLaunch a soft summer bouquet offer."
    );
    expect(prompt).toContain(
      "Treat official assets as evidence"
    );
    expect(prompt).toContain(
      "### Mandatory on-artwork copy"
    );
    expect(prompt).toContain(
      "- Exact headline: “Flowers that make the room feel softer”"
    );
    expect(prompt).toContain("- Mandatory CTA: “Order a bouquet”");
    expect(prompt).toContain(
      "Canvas:\n1:1 single-static"
    );
    expect(prompt).toContain(
      "Latest user correction:\nMANDATORY ARTWORK BRIEF — USER-SUPPLIED FINAL-ART REQUIREMENT"
    );
    expect(prompt).toContain(artworkBriefTail);
    expect(prompt).not.toContain("Earlier correction that should be superseded.");
    expect(prompt).toContain("### Approved optional content pool");
    expect(prompt).toContain("Same-day delivery in Bangkok");
    expect(prompt).toContain("Hand-arranged seasonal stems");
    expect(prompt).not.toContain("Unselected third supporting point");
    expect(prompt).toContain(
      "Strategy-selected proof candidate"
    );
    expect(prompt).toContain(
      "Strategy-selected offer candidate"
    );
    expect(prompt).toContain(
      "Never give a single supporting sentence a checkbox, bullet, divider, numbered-step, or list-row treatment"
    );
    expect(prompt).toContain("### Information density intent");
    expect(prompt).toContain("infer from the Working Brief");
    expect(prompt).not.toContain("You may use multiple short items");
    expect(prompt).not.toContain("Build a cohesive secondary-information group");
    expect(prompt).not.toContain("Check Identification, Persuasion, and Action");
    expect(prompt).not.toContain("Complete the ad unit");
    expect(prompt).toContain(
      "Choose the information architecture freely for the campaign's actual communication job"
    );
    expect(prompt).toContain("### Attached artifact roles");
    expect(prompt).toContain(
      '"role": "Primary reference · Logo · Latest logo"'
    );
    expect(prompt).toContain(
      '"role": "Supporting reference · Style · Workshop CTA"'
    );
    expect(prompt).toContain('"kind": "official-logo"');
    expect(prompt).toContain("This is an official logo asset only");
    expect(prompt).toContain(
      "Do not use it as a style, composition, lighting, spatial-density, or visual-treatment reference"
    );
    expect(prompt).toContain(
      "Use this image only for its stated style-reference role"
    );
    expect(prompt).toContain(
      "focus, texture, and grain"
    );
    expect(prompt).toContain('"brandLibrary"');
    expect(prompt).toContain('"guidelines"');
    expect(prompt).toContain("EDITABLE SOURCE GUIDELINE");
    expect(prompt).toContain("use Söhne Breit for headlines");
    expect(prompt).toContain("preserve 48 px clear space");
    expect(prompt).not.toContain("DERIVED STALE GUIDELINE");
    expect(prompt).toContain('"relevantProductOrService"');
    expect(prompt).toContain("Flower delivery service");
    expect(prompt).not.toContain("AI SEO / AEO / GEO");
    expect(prompt).not.toContain("KOL campaign support");
    expect(prompt).not.toContain('"title": "Campaign brief"');
    expect(prompt).not.toContain('"brandMemory"');
    expect(prompt).not.toContain('"brandRules"');
    expect(prompt).not.toContain('"caption"');
    expect(prompt).not.toContain("Fresh flowers for calm homes.");
    expect(prompt).not.toContain("Connects the offer to a clear room mood.");
    expect(prompt).not.toContain(
      "Soft natural light with bouquet on table."
    );
    expect(prompt).not.toContain('"selectedEvidence"');
    expect(prompt).not.toContain("Style-only reference — study composition");
    expect(prompt).not.toContain("Approved visual direction");
    expect(prompt).not.toContain("preferredLayout");
    expect(prompt).not.toContain("preferredHeroType");
    expect(prompt).toContain("Static artwork rules:");
    expect(prompt).not.toContain("Album master rules:");
    expect(prompt).not.toContain("2048 × 2048");
    expect(prompt).not.toContain("panel seams");
    expect(prompt).not.toContain("ALBUM MASTER GRID");
    expect(prompt).not.toContain("ONE CAMPAIGN WORLD IS MANDATORY");
    expect(prompt).not.toContain("CTA UNIQUENESS IS MANDATORY");
    expect(prompt).not.toContain("The prescribed layout is non-negotiable");
    expect(prompt).not.toContain(
      "Do not render sequence labels, page numbers, step numbers"
    );
    expect(prompt).not.toContain("{{");
    expect(prompt).not.toContain("{hook.");
    expect(prompt).not.toContain("{commercialStyle}");
    expect(prompt.length).toBeLessThanOrEqual(32_000);
    expect(strategyCalls).toHaveLength(2);
    expect(strategyCalls[0]?.model).toBe("anthropic/claude-sonnet-4.6");
    expect(strategyCalls[1]?.model).toBe("anthropic/claude-sonnet-4.6");
    const strategyPrompt = (
      strategyCalls[0]?.input as { content?: { text?: string }[] }[]
    )?.[0]?.content?.[0]?.text;
    const conceptPrompt = (
      strategyCalls[1]?.input as { content?: { text?: string }[] }[]
    )?.[0]?.content?.[0]?.text;
    expect(strategyPrompt).toContain(
      "You are the Creative Compass Strategy Enrichment Agent"
    );
    expect(strategyPrompt).not.toContain(
      "Select the minimum distinct evidence needed"
    );
    expect(conceptPrompt).toContain(
      "Think like a senior advertising creative director"
    );
    expect(conceptPrompt).toContain("RUNTIME OUTPUT ENVELOPE");
  });

  it("surfaces prompt-agent failure instead of silently generating with a fallback", async () => {
    const generationCalls: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/auth/v1/user")) {
        return new Response(
          JSON.stringify({ email: "team@convertcake.com" }),
          { status: 200 }
        );
      }
      if (href.includes("/v1/responses")) {
        return new Response("agent unavailable", { status: 500 });
      }
      if (href.includes("/v1/images/generations")) {
        const body = JSON.parse(String(init?.body)) as { prompt: string };
        generationCalls.push(body.prompt);
        return new Response(
          JSON.stringify({
            data: [{ b64_json: Buffer.from("fake-png-bytes").toString("base64") }]
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected fetch: ${href}`);
    });

    const { client } = fakeStorage();

    const response = await handleArtworkGenerationRequest({
      request: new Request("https://moons.local/api/artwork-generation", {
        method: "POST",
        headers: { authorization: "Bearer user-token" },
        body: JSON.stringify({
          ...requestBody,
          artworkMode: "design-system"
        })
      }),
      env: {
        OPENAI_API_KEY: "test-key",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      createStorageClient: () => client
    });

    expect(response.status).toBe(500);
    expect(generationCalls).toEqual([]);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "OpenAI image prompt agent failed: 500 — agent unavailable"
    });
  });

  it("continues to image generation when optional strategy evidence validation fails", async () => {
    const generationCalls: string[] = [];
    const fetchMock = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url);
        if (href.includes("/auth/v1/user")) {
          return new Response(
            JSON.stringify({ email: "team@convertcake.com" }),
            { status: 200 }
          );
        }
        if (href.includes("/v1/responses")) {
          const body = JSON.parse(String(init?.body)) as {
            text?: { format?: { name?: string } };
          };
          if (
            body.text?.format?.name === "moons_creative_visual_concept"
          ) {
            return creativeGraphicDesignerResponse();
          }
          return new Response(
            JSON.stringify({
              output_text: JSON.stringify({
                commercialStyle: "story",
                sellingMechanism: "problem-solution",
                preferredMode: "standard_commercial",
                preferredLayout: "architectural_plane_split",
                preferredHeroType: "object_metaphor",
                humanPresence: "avoid",
                audienceMoment: "The customer wants an easier daily routine.",
                reasonToBelieve: "Show the benefit through the visual.",
                visibleProofDirection: "A clear before-and-after visual.",
                offer: { text: "", evidenceId: "", source: "none" },
                proof: [],
                differentiator: {
                  text: "Paraphrased campaign difference",
                  evidenceId: "brief:0",
                  source: "verified"
                },
                referenceSearchText: "clean problem-solution artwork",
                evidenceStatus: "verified",
                requiresTextReview: false,
                missingEvidence: []
              })
            }),
            { status: 200 }
          );
        }
        if (href.includes("/v1/images/generations")) {
          const body = JSON.parse(String(init?.body)) as { prompt: string };
          generationCalls.push(body.prompt);
          return new Response(
            JSON.stringify({
              data: [
                {
                  b64_json: Buffer.from("fake-png-bytes").toString("base64")
                }
              ]
            }),
            { status: 200 }
          );
        }
        throw new Error(`Unexpected fetch: ${href}`);
      }
    );
    const { client } = fakeStorage();

    const response = await handleArtworkGenerationRequest({
      request: new Request("https://moons.local/api/artwork-generation", {
        method: "POST",
        headers: { authorization: "Bearer user-token" },
        body: JSON.stringify({
          ...requestBody,
          artworkMode: "design-system"
        })
      }),
      env: {
        OPENAI_API_KEY: "test-key",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      createStorageClient: () => client
    });

    expect(response.status, await response.clone().text()).toBe(200);
    expect(generationCalls).toHaveLength(1);
    expect(generationCalls[0]).toContain(
      "### Creative provocation"
    );
  });

  it("sends Direct Final Artwork straight to GPT Image 2 with only the approved idea fields and complete brand context", async () => {
    const generationCalls: string[] = [];
    const editableGuideline =
      "Typography: use a refined Thai-compatible grotesk. Logo clear space: one cap height. Imagery: warm directional light with credible contact shadows. GUIDELINE-END.";
    const artworkBrief =
      "MANDATORY ARTWORK BRIEF: Keep one quiet upper-right area and use natural window light.";
    const fetchMock = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url);
        if (href.includes("/auth/v1/user")) {
          return new Response(
            JSON.stringify({ email: "team@convertcake.com" }),
            { status: 200 }
          );
        }
        if (href.includes("/v1/responses")) {
          throw new Error("Direct Final Artwork must not call an upstream agent.");
        }
        if (href.includes("/v1/images/generations")) {
          const body = JSON.parse(String(init?.body)) as { prompt: string };
          generationCalls.push(body.prompt);
          return new Response(
            JSON.stringify({
              data: [
                {
                  b64_json: Buffer.from("fake-png-bytes").toString("base64")
                }
              ]
            }),
            { status: 200 }
          );
        }
        throw new Error(`Unexpected fetch: ${href}`);
      }
    );
    const { client } = fakeStorage();

    const response = await handleArtworkGenerationRequest({
      request: new Request("https://moons.local/api/artwork-generation", {
        method: "POST",
        headers: { authorization: "Bearer user-token" },
        body: JSON.stringify({
          ...requestBody,
          artworkMode: "direct-final-artwork",
          imagePromptModel: "anthropic/claude-sonnet-4.6",
          brand: {
            ...requestBody.brand,
            personality: ["quiet luxury", "warm"],
            colors: ["#FFFFFF", "#E7CEB5", "#006072", "#A38D5C"]
          },
          selectedHooks: [
            {
              ...requestBody.selectedHooks[0],
              subheadline: "A softer room starts with one thoughtful detail",
              supportingPoints: [
                "Seasonal stems selected daily",
                "Arranged by local florists"
              ],
              why: "THIS RATIONALE MUST NOT BE FORWARDED",
              visual: "THIS VISUAL DIRECTION MUST NOT BE FORWARDED",
              caption: "THIS CAPTION MUST NOT BE FORWARDED"
            }
          ],
          textInputs: [artworkBrief],
          brandMemory: {
            working: ["Use restrained premium composition."],
            avoid: ["Avoid synthetic glossy CGI."]
          },
          brandLibrary: {
            brand: [
              {
                id: "colors",
                title: "Colors",
                description: "#FFFFFF, #E7CEB5, #006072, #A38D5C"
              },
              {
                id: "tone",
                title: "Tone & Style",
                description: "Quiet, warm, refined."
              }
            ],
            products: [
              {
                id: "bouquet",
                title: "Seasonal bouquet",
                description: "Hand-arranged seasonal flower delivery."
              }
            ],
            docs: [
              {
                id: "guideline",
                title: "Brand guideline",
                description: editableGuideline
              }
            ],
            refs: []
          }
        })
      }),
      env: {
        OPENAI_API_KEY: "test-key",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      createStorageClient: () => client
    });

    expect(response.status, await response.clone().text()).toBe(200);
    expect(generationCalls).toHaveLength(1);
    const prompt = generationCalls[0]!;
    expect(prompt).toContain("# GPT IMAGE 2 — DIRECT FINAL ARTWORK V2.0");
    const ideaText = prompt
      .split("## 2. APPROVED IDEA\n\n")[1]
      ?.split("\n\nTreat this JSON")[0];
    expect(ideaText).toBeTruthy();
    const idea = JSON.parse(ideaText!) as Record<string, unknown>;
    expect(Object.keys(idea)).toEqual([
      "Hook",
      "subheadline",
      "Supporting points (one per line)",
      "CTA"
    ]);
    expect(idea).toEqual({
      Hook: "Flowers that make the room feel softer",
      subheadline: "A softer room starts with one thoughtful detail",
      "Supporting points (one per line)": [
        "Seasonal stems selected daily",
        "Arranged by local florists"
      ],
      CTA: "Order a bouquet"
    });
    expect(prompt).toContain(editableGuideline);
    expect(prompt).toContain(artworkBrief);
    expect(prompt).toContain('"#FFFFFF"');
    expect(prompt).toContain('"#E7CEB5"');
    expect(prompt).toContain('"#006072"');
    expect(prompt).toContain('"#A38D5C"');
    expect(prompt).not.toContain("THIS RATIONALE MUST NOT BE FORWARDED");
    expect(prompt).not.toContain("THIS VISUAL DIRECTION MUST NOT BE FORWARDED");
    expect(prompt).not.toContain("THIS CAPTION MUST NOT BE FORWARDED");
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("/v1/responses")
      )
    ).toBe(false);
  });

  it("runs the set director, archived 01/02 prompts, and V6.2 without post-generation visual QC", async () => {
    const responseInputs: string[] = [];
    const generationCalls: string[] = [];
    const fetchMock = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url);
        if (href.includes("/auth/v1/user")) {
          return new Response(
            JSON.stringify({ email: "team@convertcake.com" }),
            { status: 200 }
          );
        }
        if (href.includes("/v1/responses")) {
          const body = JSON.parse(String(init?.body)) as {
            input?: { content?: { type?: string; text?: string }[] }[];
          };
          const inputText = body.input?.[0]?.content?.find(
            (item) => item.type === "input_text"
          )?.text ?? "";
          responseInputs.push(inputText);
          if (inputText.includes("# CREATIVE SET DIRECTOR")) {
            return creativeSetDirectionResponse();
          }
          if (inputText.includes("# CREATIVE CONCEPT DIRECTOR")) {
            return creativeVisualConceptResponse();
          }
          if (inputText.includes("# VISUAL QUALITY CONTROL")) {
            return visualQualityPassResponse();
          }
          return strategyAgentResponse();
        }
        if (href.includes("/v1/images/generations")) {
          const body = JSON.parse(String(init?.body)) as { prompt: string };
          generationCalls.push(body.prompt);
          return new Response(
            JSON.stringify({
              data: [
                {
                  b64_json: Buffer.from("fake-png-bytes").toString("base64")
                }
              ]
            }),
            { status: 200 }
          );
        }
        throw new Error(`Unexpected fetch: ${href}`);
      }
    );
    const { client } = fakeStorage();

    const response = await handleArtworkGenerationRequest({
      request: new Request("https://moons.local/api/artwork-generation", {
        method: "POST",
        headers: { authorization: "Bearer user-token" },
        body: JSON.stringify({
          ...requestBody,
          artworkMode: "design-system-new"
        })
      }),
      env: {
        OPENAI_API_KEY: "test-key",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      createStorageClient: () => client
    });

    expect(response.status, await response.clone().text()).toBe(200);
    expect(responseInputs).toHaveLength(3);
    expect(responseInputs[0]).toContain("# CREATIVE SET DIRECTOR");
    expect(responseInputs[0]).toContain("LOCKED CAMPAIGN INPUT");
    expect(responseInputs[1]).toContain(
      "CREATIVE COMPASS — STRATEGY ENRICHMENT AGENT V2"
    );
    expect(responseInputs[2]).toContain("# CREATIVE CONCEPT DIRECTOR");
    expect(responseInputs[2]).toContain("AUTHORITATIVE RUNTIME INPUT");
    expect(responseInputs[2]).toContain("campaignSetDirection");
    expect(responseInputs[2]).toContain("shotOpportunity");
    expect(responseInputs.join("\n")).not.toContain(
      requestBody.selectedHooks[0]!.visual
    );
    expect(responseInputs.join("\n")).not.toContain("# VISUAL QUALITY CONTROL");
    expect(responseInputs.join("\n")).not.toContain(
      "# CAMPAIGN TRUTH NORMALIZER"
    );
    expect(generationCalls).toHaveLength(1);
    expect(generationCalls[0]).toContain(
      "GPT IMAGE 2 — ADAPTIVE FINAL ART DIRECTOR V6.3"
    );
    expect(generationCalls[0]).toContain(
      "### Campaign set direction"
    );
    expect(generationCalls[0]).toContain(
      "A quiet botanical campaign world"
    );
    expect(generationCalls[0]).toContain(
      "### Per-idea shot opportunity"
    );
    expect(generationCalls[0]).toContain("### Creative provocation");
    expect(generationCalls[0]).not.toContain(
      requestBody.selectedHooks[0]!.visual
    );
    expect(generationCalls[0]).not.toContain(
      "LOCKED AUTHORITATIVE CAMPAIGN PACKET"
    );
  });

  it("does not run or revise with post-generation visual QC while it is disabled", async () => {
    let visualQcCalls = 0;
    let generationCalls = 0;
    const editCalls: FormData[] = [];
    const fetchMock = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url);
        if (href.includes("/auth/v1/user")) {
          return new Response(
            JSON.stringify({ email: "team@convertcake.com" }),
            { status: 200 }
          );
        }
        if (href.includes("/v1/responses")) {
          const body = JSON.parse(String(init?.body)) as {
            input?: { content?: { type?: string; text?: string }[] }[];
          };
          const inputText = body.input?.[0]?.content?.find(
            (item) => item.type === "input_text"
          )?.text ?? "";
          if (inputText.includes("# CREATIVE SET DIRECTOR")) {
            return creativeSetDirectionResponse();
          }
          if (inputText.includes("# CREATIVE CONCEPT DIRECTOR")) {
            return creativeVisualConceptResponse();
          }
          if (inputText.includes("# VISUAL QUALITY CONTROL")) {
            visualQcCalls += 1;
            return visualQualityReviseResponse();
          }
          return strategyAgentResponse();
        }
        if (href.includes("/v1/images/generations")) {
          generationCalls += 1;
          return new Response(
            JSON.stringify({
              data: [
                {
                  b64_json: Buffer.from("initial-image").toString("base64")
                }
              ]
            }),
            { status: 200 }
          );
        }
        if (href.includes("/v1/images/edits")) {
          editCalls.push(init?.body as FormData);
          return new Response(
            JSON.stringify({
              data: [
                {
                  b64_json: Buffer.from("revised-image").toString("base64")
                }
              ]
            }),
            { status: 200 }
          );
        }
        throw new Error(`Unexpected fetch: ${href}`);
      }
    );
    const { client } = fakeStorage();

    const response = await handleArtworkGenerationRequest({
      request: new Request("https://moons.local/api/artwork-generation", {
        method: "POST",
        headers: { authorization: "Bearer user-token" },
        body: JSON.stringify({
          ...requestBody,
          artworkMode: "design-system-new"
        })
      }),
      env: {
        OPENAI_API_KEY: "test-key",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      createStorageClient: () => client
    });

    expect(response.status, await response.clone().text()).toBe(200);
    expect(generationCalls).toBe(1);
    expect(visualQcCalls).toBe(0);
    expect(editCalls).toHaveLength(0);
  });
});
