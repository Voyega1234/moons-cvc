import { describe, expect, it, vi } from "vitest";
import {
  handleArtworkGenerationRequest,
  type ArtworkStorageClient
} from "./artwork-generation-endpoint";

const requestBody = {
  model: "gpt-image-2",
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
    const payload = (await response.json()) as {
      outputs: Array<Record<string, unknown>>;
    };

    expect(payload.outputs).toHaveLength(1);
    expect(payload.outputs[0]).toMatchObject({
      directionId: "hook-1",
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
          { kind: "url", url: "https://example.com/reference.png" }
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
    expect(uploads).toHaveLength(1);
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
    expect(generationCalls).toEqual([
      "AGENT-WRITTEN PROMPT: luxury typography key visual."
    ]);
  });

  it("falls back to the deterministic prompt when the prompt agent fails", async () => {
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

    expect(response.status).toBe(200);
    expect(generationCalls[0]).toContain(
      "Hook: Flowers that make the room feel softer"
    );
  });
});
