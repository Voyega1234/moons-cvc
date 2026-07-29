import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  albumCropRegions,
  buildActiveHumanPresenceRules,
  detectAlbumBoundaries,
  handleArtworkGenerationRequest,
  type ArtworkStorageClient
} from "./artwork-generation-endpoint";

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
  return body.text?.format?.name === "moons_creative_design_input"
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
        if (body.text?.format?.name === "moons_creative_design_input") {
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
    expect(regions[0]).toMatchObject({
      index: 1,
      width: boundaries.vertical,
      height
    });
    expect(regions[1]?.height).toBe(boundaries.secondaryHorizontal);
    expect(regions[2]?.height).toBe(
      boundaries.horizontal! - boundaries.secondaryHorizontal!
    );
    expect(regions[3]?.top).toBe(boundaries.horizontal);
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
  ])("cuts $format using its detected boundaries", ({
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
    expect(prompt).toContain("meaningful enhancement of Image 1");
    expect(prompt).toContain("Increase whitespace around the CTA.");
    expect(prompt).toContain("minimum required improvement");
    expect(prompt).toContain("change font style");
    expect(prompt).toContain("Google or Meta");
    expect(prompt).toContain("anti-AI production audit");
    expect(prompt).toContain("must not look obviously AI-generated");
    expect(prompt).toContain("earn the intended audience's attention within one second");
    expect(prompt).toContain("strengthen rather than weaken brand perception");
    expect(prompt).toContain("contact shadows");
    expect(prompt).toContain("one plausible lighting system");
    expect(prompt).toContain("Balance, Contrast, Emphasis, Movement");
    expect(prompt).toContain("mobile-feed size");
    expect(prompt).toContain("material improvement in at least three areas");
    expect(prompt).not.toContain(requestBody.brief);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/v1/responses"))).toBe(false);
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

  it("generates and uploads artwork for each selected hook", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/auth/v1/user")) {
        return new Response(
          JSON.stringify({ email: "team@convertcake.com" }),
          { status: 200 }
        );
      }
      if (href.includes("/v1/responses")) {
        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              finalPrompt: "AGENT-WRITTEN PROMPT: soft editorial bouquet."
            })
          }),
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
    expect(debugLogs).toEqual([
      expect.objectContaining({
        kind: "image-prompt-agent",
        model: "gpt-5.6-terra",
        directionId: "hook-1",
        mode: "standard",
        status: "succeeded",
        request: expect.objectContaining({
          endpoint: "/v1/responses",
          store: false,
          inputText: expect.stringContaining(
            '"headline": "Flowers that make the room feel softer"'
          ),
          referenceImages: [],
          responseFormat: expect.objectContaining({
            name: "moons_image_generation_prompt",
            strict: true
          })
        }),
        response: {
          prompt: "AGENT-WRITTEN PROMPT: soft editorial bouquet."
        }
      }),
      expect.objectContaining({
        model: "gpt-image-2",
        runId: "run-1",
        directionId: "hook-1",
        request: expect.objectContaining({
          endpoint: "/v1/images/generations",
          body: expect.objectContaining({
            model: "gpt-image-2",
            prompt: expect.stringContaining("Flowers that make the room feel softer"),
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

  it("uses the requested output size and passes the matching canvas ratio to the prompt agent", async () => {
    const promptAgentInputs: string[] = [];
    const imageBodies: unknown[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/auth/v1/user")) {
        return new Response(
          JSON.stringify({ email: "team@convertcake.com" }),
          { status: 200 }
        );
      }
      if (href.includes("/v1/responses")) {
        const body = JSON.parse(String(init?.body)) as {
          input: Array<{ content: Array<{ type: string; text?: string }> }>;
        };
        promptAgentInputs.push(body.input[0]?.content[0]?.text ?? "");
        return promptAgentResponse("AGENT-WRITTEN PROMPT: landscape artwork.");
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
    expect(promptAgentInputs[0]).toContain('"ratio": "16:9"');
    expect(imageBodies[0]).toMatchObject({ size: "3840x2160" });
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
        return promptAgentResponse("A cohesive three-image album sequence.");
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
    expect(imageBodies).toHaveLength(1);
    expect(imageBodies[0]?.size).toBe("2048x2048");
    expect(imageBodies[0]?.prompt).toContain("ALBUM MASTER GRID");
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
      "# FINAL ART DIRECTOR"
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
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/auth/v1/user")) {
        return new Response(JSON.stringify({ email: "team@convertcake.com" }), {
          status: 200
        });
      }
      if (href.includes("/v1/responses")) {
        return promptAgentResponse();
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
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/auth/v1/user")) {
        return new Response(
          JSON.stringify({ email: "team@convertcake.com" }),
          { status: 200 }
        );
      }
      if (href.includes("/v1/responses")) {
        return promptAgentResponse();
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

  it("downloads reference images and calls the edits endpoint with them attached", async () => {
    const editCalls: { href: string; body: FormData }[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/auth/v1/user")) {
        return new Response(
          JSON.stringify({ email: "team@convertcake.com" }),
          { status: 200 }
        );
      }
      if (href.includes("/reference.png")) {
        return new Response(Buffer.from("fake-reference-bytes"), {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
      if (href.includes("/v1/responses")) {
        return promptAgentResponse();
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
    expect(editCalls).toHaveLength(1);
    const referenceFile = editCalls[0]?.body.get("image[]") as File;
    expect(referenceFile.type).toBe("image/png");
    expect(editCalls[0]?.body.get("prompt")).toContain(
      "REFERENCE-INFORMED DESIGN — highest priority:"
    );
    expect(editCalls[0]?.body.get("prompt")).toContain(
      "CONCEPT ALIGNMENT — highest priority:"
    );
    expect(editCalls[0]?.body.get("prompt")).toContain(
      "Image 1 — Past work style reference — Convert Cake campaign"
    );
    expect(editCalls[0]?.body.get("prompt")).toContain(
      "PAST-WORK VISUAL DNA:"
    );
    expect(editCalls[0]?.body.get("prompt")).toContain(
      "STYLE FIDELITY IS MANDATORY"
    );
    expect(editCalls[0]?.body.get("prompt")).toContain(
      "same mood, tone, and visual style family"
    );
    expect(editCalls[0]?.body.get("prompt")).toContain(
      "preferred Thai/English/mixed language behavior"
    );
    expect(editCalls[0]?.body.get("prompt")).toContain(
      "Do not copy the past work's main visual"
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
            arrayBuffer: async () => Buffer.from("stored-reference")
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
                  bytes: Buffer.from("stored-reference").length
                },
                {
                  label: "Creative Compass artwork reference — secondary",
                  mimeType: "image/jpeg",
                  bytes: Buffer.from("stored-reference").length
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

  it("uses the prompt written by the image prompt agent", async () => {
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
        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              prompt: "AGENT-WRITTEN PROMPT: luxury typography key visual."
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
            data: [{ b64_json: Buffer.from("fake-png-bytes").toString("base64") }]
          }),
          { status: 200 }
        );
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
    expect(generationCalls).toHaveLength(1);
    expect(generationCalls[0]).toContain(
      "AGENT-WRITTEN PROMPT: luxury typography key visual."
    );
  });

  it("routes the selected Claude prompt model through OpenRouter", async () => {
    const promptCalls: Array<{
      model: string;
      authorization: string | null;
    }> = [];
    const imageAuthorizations: Array<string | null> = [];
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
          const body = JSON.parse(String(init?.body)) as { model: string };
          promptCalls.push({
            model: body.model,
            authorization: new Headers(init?.headers).get("Authorization")
          });
          return new Response(
            JSON.stringify({
              output_text: JSON.stringify({
                prompt: "OPENROUTER PROMPT: editorial conversion visual."
              })
            }),
            { status: 200 }
          );
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
        OPENROUTER_API_KEY: "openrouter-prompt-key",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      createStorageClient: () => client
    });

    expect(response.status).toBe(200);
    expect(promptCalls).toEqual([
      {
        model: "anthropic/claude-sonnet-4.6",
        authorization: "Bearer openrouter-prompt-key"
      }
    ]);
    expect(imageAuthorizations).toEqual(["Bearer openai-image-key"]);
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

  it("adds a structured creative input packet before sending the campaign to GPT Image 2", async () => {
    const editCalls: FormData[] = [];
    const strategyCalls: Record<string, unknown>[] = [];
    const oversizedContext = "Brand context detail ".repeat(500);
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
        return body.text?.format?.name === "moons_creative_design_input"
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
            "Keep more breathing space around the headline."
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
      "# FINAL ART DIRECTOR"
    );
    expect(prompt).toContain(
      "Use the authoritative campaign input below to create the final artwork"
    );
    expect(prompt).toContain(
      "Create a complete Thai commercial performance-ad composite"
    );
    expect(prompt).toContain(
      "Build the canvas from four dominant visual masses"
    );
    expect(prompt).toContain(
      "Use a full-frame designed background as an active graphic stage"
    );
    expect(prompt).toContain(
      "Let the visual earn first attention"
    );
    expect(prompt).toContain(
      "one coherent lighting world"
    );
    expect(prompt).toContain(
      "Organize supporting information into no more than two compact modules"
    );
    expect(prompt).toContain(
      "Use a disciplined commercial palette"
    );
    expect(prompt).toContain(
      "Every visible element must earn its place"
    );
    expect(prompt).toContain("Selling mechanism:\ndesire");
    expect(prompt).toContain(
      "Infer whether human presence materially improves the campaign message"
    );
    expect(prompt).toContain(
      "### Creative input packet prepared by Creative Graphic Designer"
    );
    expect(prompt).toContain(
      "A bouquet appears to soften the hard geometry of a room"
    );
    expect(prompt).toContain("Brand:\nFlora Daily");
    expect(prompt).toContain(
      "Headline, exactly:\n“Flowers that make the room feel softer”"
    );
    expect(prompt).toContain(
      "Highlighted phrase:\n“room feel softer”"
    );
    expect(prompt).toContain("Feature name:\nOMIT");
    expect(prompt).toContain("CTA, exactly:\n“Order a bouquet”");
    expect(prompt).not.toContain("Do not use people, faces, bodies");
    expect(prompt).not.toContain("remain clearly subordinate");
    expect(prompt).toContain(
      "Business problem and communication objective:\nLaunch a soft summer bouquet offer."
    );
    expect(prompt).toContain(
      "Preserve fields marked `exactly` verbatim"
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
      "Latest user correction:\nKeep more breathing space around the headline."
    );
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
      "Integrate the supplied product accurately."
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
            body.text?.format?.name === "moons_creative_design_input"
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
      "### Creative input packet prepared by Creative Graphic Designer"
    );
  });

  it("uses the new production brief agent before GPT Image 2 in design-system-new mode", async () => {
    const responseInputs: string[] = [];
    const generationCalls: string[] = [];
    const productionBrief = [
      "Create one finished 1:1 Facebook advertising artwork.",
      "CENTRAL IDEA",
      "A bouquet visibly softens the room.",
      "VISUAL EVENT",
      "Rigid shadows relax into gentle curves around the flowers.",
      "COMPOSITION",
      "Bouquet right, headline left, quiet space above.",
      "SUBJECT AND ENVIRONMENT",
      "Official bouquet in a calm lived-in room.",
      "CAMERA",
      "Eye-level medium-wide environmental crop.",
      "LIGHT AND MATERIAL",
      "Soft daylight, natural shadows, tactile petals and plaster.",
      "TYPOGRAPHY",
      "Use the exact headline and CTA once.",
      "OFFICIAL ASSETS",
      "Preserve every attached official asset exactly.",
      "IMMUTABLE FACTS",
      "Preserve approved product, offer, and copy.",
      "DO NOT INVENT",
      "No unsupported claims, offers, or products.",
      "OUTPUT",
      "Render one complete artwork only."
    ].join("\n");
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
          if (inputText.includes("# GPT IMAGE 2 PRODUCTION BRIEF DIRECTOR")) {
            return promptAgentResponse(productionBrief);
          }
          if (inputText.includes("# CREATIVE CONCEPT DIRECTOR")) {
            return creativeGraphicDesignerResponse();
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
    expect(responseInputs[1]).toContain("# CREATIVE CONCEPT DIRECTOR");
    expect(responseInputs[2]).toContain(
      "# GPT IMAGE 2 PRODUCTION BRIEF DIRECTOR"
    );
    expect(responseInputs[2]).toContain(
      "# FINAL ART DIRECTOR"
    );
    expect(generationCalls).toEqual([productionBrief]);
    expect(generationCalls[0]).not.toContain(
      "# FINAL ART DIRECTOR"
    );
  });
});
