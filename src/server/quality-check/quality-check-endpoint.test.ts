import { describe, expect, it, vi } from "vitest";
import { handleQualityCheckRequest } from "./quality-check-endpoint";

const requestBody = {
  runId: "run-1",
  brief: "Launch a soft summer bouquet offer.",
  brandContext: {
    name: "Petal House",
    category: "Florist",
    brandKit: ["Logo: green wordmark"],
    products: ["Summer bouquet: THB 990"],
    documents: ["Campaign brief: summer launch"],
    working: ["Natural light"],
    avoid: ["Hard shadows"]
  },
  referenceImages: [
    {
      label: "Approved mockup",
      url: "https://example.com/reference.png",
      kind: "creative-reference"
    }
  ],
  outputs: [
    {
      id: "output-1",
      hook: "Flowers that make the room feel softer",
      subheadline: "A summer bouquet for a calmer room.",
      concept: "Lead with room mood.",
      visual: "Soft natural light with bouquet on table.",
      cta: "Order today",
      caption: "Summer bouquet, THB 990.",
      revisionFeedback: "CS: Keep the price visible.",
      assetUrl: "https://example.supabase.co/storage/v1/object/sign/creative-assets/output-1.png"
    }
  ]
};

function buildRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://moons.local/api/quality-check", {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody)
  });
}

describe("handleQualityCheckRequest", () => {
  it("requires a Supabase user token when backend Supabase env is configured", async () => {
    const response = await handleQualityCheckRequest({
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

  it("sends each image inline to the vision model and returns per-output results", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const href = String(url);
      if (href.includes("example.com/reference.png")) {
        return new Response(Buffer.from("reference-image"), {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
      if (href.includes("example.supabase.co/storage")) {
        return new Response(Buffer.from("creative-image"), {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
      return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              results: [
                {
                  outputId: "output-1",
                  gdPassed: false,
                  gdReason: "ข้อความในภาพอ่านไม่ชัด",
                  csPassed: true,
                  csReason: "Key Message และราคาตรงกับ Brief"
                }
              ]
            })
          }),
          { status: 200 }
        );
    });

    const response = await handleQualityCheckRequest({
      request: buildRequest(),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      results: {
        outputId: string;
        gdPassed: boolean;
        gdReason: string;
        csPassed: boolean;
        csReason: string;
        passed: boolean;
        reason: string;
      }[];
    };
    expect(payload.results).toEqual([
      {
        outputId: "output-1",
        gdPassed: false,
        gdReason: "ข้อความในภาพอ่านไม่ชัด",
        csPassed: true,
        csReason: "Key Message และราคาตรงกับ Brief",
        passed: false,
        reason:
          "GD ต้องแก้: ข้อความในภาพอ่านไม่ชัด\nCS ผ่าน: Key Message และราคาตรงกับ Brief"
      }
    ]);

    const openAiCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/v1/responses")
    );
    const body = JSON.parse(String(openAiCall?.[1]?.body)) as {
      input: {
        content: { type: string; text?: string; image_url?: string }[];
      }[];
    };
    const imageBlocks = body.input[0]?.content.filter(
      (block) => block.type === "input_image"
    );
    expect(imageBlocks).toEqual([
      expect.objectContaining({
        image_url: expect.stringMatching(/^data:image\/png;base64,/)
      }),
      expect.objectContaining({
        image_url: expect.stringMatching(/^data:image\/png;base64,/)
      })
    ]);
    const prompt = body.input[0]?.content
      .filter((block) => block.type === "input_text")
      .map((block) => block.text)
      .join("\n");
    expect(prompt).toContain("ความสวยงาม องค์ประกอบ และจุดนำสายตา");
    expect(prompt).toContain("Key Message ชัด และตรง Brief / Objective");
    expect(prompt).toContain("Brand: Petal House");
    expect(prompt).toContain("Caption: Summer bouquet, THB 990.");
    expect(prompt).toContain("Revision Feedback: CS: Keep the price visible.");
  });

  it("returns no results without calling OpenAI when there are no outputs", async () => {
    const fetchMock = vi.fn();

    const response = await handleQualityCheckRequest({
      request: new Request("https://moons.local/api/quality-check", {
        method: "POST",
        body: JSON.stringify({ runId: "run-1", brief: "test", outputs: [] })
      }),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, results: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips unavailable reference images while still checking generated creatives", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const href = String(url);
      if (href.includes("example.com/reference.png")) {
        return new Response("blocked", { status: 400 });
      }
      if (href.includes("example.supabase.co/storage")) {
        return new Response(Buffer.from("creative-image"), {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            results: [
              {
                outputId: "output-1",
                gdPassed: true,
                gdReason: "ผ่าน",
                csPassed: true,
                csReason: "ผ่าน"
              }
            ]
          })
        }),
        { status: 200 }
      );
    });

    const response = await handleQualityCheckRequest({
      request: buildRequest(),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(200);
    const openAiCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/v1/responses")
    );
    const body = JSON.parse(String(openAiCall?.[1]?.body)) as {
      input: {
        content: { type: string; text?: string; image_url?: string }[];
      }[];
    };
    const content = body.input[0]?.content ?? [];
    expect(content.filter((block) => block.type === "input_image")).toHaveLength(
      1
    );
    expect(content.map((block) => block.text).join("\n")).toContain(
      "ข้ามภาพนี้เพราะ backend ดาวน์โหลดไม่ได้"
    );
  });

  it("returns failed QA results instead of crashing when the agent returns malformed JSON", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const href = String(url);
      if (href.includes("example.com/reference.png")) {
        return new Response(Buffer.from("reference-image"), {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
      if (href.includes("example.supabase.co/storage")) {
        return new Response(Buffer.from("creative-image"), {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
      return new Response(
        JSON.stringify({
          output_text:
            '{"results":[{"outputId":"output-1","gdPassed":true,"gdReason":"unterminated'
        }),
        { status: 200 }
      );
    });

    const response = await handleQualityCheckRequest({
      request: buildRequest(),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      results: { outputId: string; passed: boolean; reason: string }[];
    };
    expect(payload.results).toEqual([
      expect.objectContaining({
        outputId: "output-1",
        passed: false,
        reason: expect.stringContaining(
          "Quality agent returned malformed JSON"
        )
      })
    ]);
  });

  it("returns the OpenAI error message when quality check request is rejected", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const href = String(url);
      if (href.includes("example.com/reference.png")) {
        return new Response(Buffer.from("reference-image"), {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
      if (href.includes("example.supabase.co/storage")) {
        return new Response(Buffer.from("creative-image"), {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
      return new Response(
          JSON.stringify({
            error: {
              message: "Invalid value: image_url could not be downloaded."
            }
          }),
          { status: 400 }
        );
    });

    const response = await handleQualityCheckRequest({
      request: buildRequest(),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error:
        "OpenAI quality check failed: 400 — Invalid value: image_url could not be downloaded."
    });
  });
});
