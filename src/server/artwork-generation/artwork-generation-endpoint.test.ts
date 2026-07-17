import { describe, expect, it, vi } from "vitest";
import {
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

function strategyAgentResponse(): Response {
  return new Response(
    JSON.stringify({
      output_text: JSON.stringify({
        commercialStyle: "lifestyle",
        sellingMechanism: "desire",
        preferredMode: "standard_commercial",
        preferredLayout: "lifestyle_commercial",
        preferredHeroType: "person",
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
        missingEvidence: ["verified offer", "verified proof"]
      })
    }),
    { status: 200 }
  );
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

    const response = await handleArtworkGenerationRequest({
      request: buildRequest({ authorization: "Bearer user-token" }),
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
            label: "Convert Cake campaign reference"
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
      "Image 1 — Convert Cake campaign reference"
    );
    expect(uploads).toHaveLength(1);
  });

  it("uses a private Supabase artwork reference URL in reference-library mode", async () => {
    const strategyAgentBodies: Record<string, unknown>[] = [];
    const promptAgentBodies: Record<string, unknown>[] = [];
    const generationCalls: Record<string, unknown>[] = [];
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
      if (href.includes("/v1/images/generations")) {
        generationCalls.push(
          JSON.parse(String(init?.body)) as Record<string, unknown>
        );
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
    expect(generationCalls).toHaveLength(1);
    expect(generationCalls[0]?.prompt).toContain(
      "invent a new main visual, visual metaphor"
    );
    expect(generationCalls[0]?.prompt).toContain(
      "The Moons artwork references were analyzed upstream"
    );
    expect(generationCalls[0]?.prompt).toContain(
      "coherent in perspective, scale, lighting, shadows, color grade, depth, and material treatment"
    );
    expect(generationCalls[0]?.prompt).not.toContain("Image 1: primary artwork reference");
    expect(generationCalls[0]?.prompt).not.toContain("mode standard_commercial");
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
            endpoint: "/v1/images/generations",
            body: expect.objectContaining({
              prompt: expect.stringContaining(
                "The Moons artwork references were analyzed upstream"
              )
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
    expect(debugAssets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filename: expect.stringMatching(/-output\.png$/),
          bytes: Buffer.from("fake-png-bytes")
        })
      ])
    );
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

  it("loads the separate master prompt for design-system mode", async () => {
    const promptAgentInputs: string[] = [];
    const generationPrompts: string[] = [];
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
        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              prompt:
                "Create a textless asset-safe base visual with blank headline and CTA zones using isometric 3D cards."
            })
          }),
          { status: 200 }
        );
      }
      if (href.includes("/v1/images/generations")) {
        const body = JSON.parse(String(init?.body)) as { prompt: string };
        generationPrompts.push(body.prompt);
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

    expect(response.status).toBe(200);
    expect(promptAgentInputs).toHaveLength(1);
    expect(promptAgentInputs[0]).toContain("PASS 2 — REFERENCE FORENSICS");
    expect(promptAgentInputs[0]).toContain(
      "RUNTIME EXECUTION CONTRACT — DESIGN-SYSTEM MODE"
    );
    expect(promptAgentInputs[0]).toContain(
      "Required headline: Flowers that make the room feel softer"
    );
    expect(promptAgentInputs[0]).toContain(
      "Approved visual direction: Soft natural light with bouquet on table."
    );
    expect(generationPrompts).toHaveLength(1);
    expect(generationPrompts[0]).toContain(
      "DESIGN-SYSTEM FINAL ARTWORK CONTRACT — overrides conflicting earlier instructions:"
    );
    expect(generationPrompts[0]).toContain(
      "Render this exact headline once, clearly and prominently: “Flowers that make the room feel softer”"
    );
    expect(generationPrompts[0]).toContain(
      "Render this exact CTA once: “Order a bouquet”"
    );
    expect(generationPrompts[0]).toContain(
      "Do not create a textless base visual"
    );
    expect(generationPrompts[0]?.lastIndexOf("DESIGN-SYSTEM FINAL ARTWORK CONTRACT")).toBeGreaterThan(
      generationPrompts[0]?.indexOf("textless asset-safe base visual") ?? -1
    );
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
});
