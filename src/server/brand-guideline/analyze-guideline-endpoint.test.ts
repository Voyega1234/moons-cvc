import { describe, expect, it, vi } from "vitest";
import { handleAnalyzeGuidelineRequest } from "./analyze-guideline-endpoint";

function buildRequest(
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Request {
  return new Request("https://moons.local/api/analyze-brand-guideline", {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
}

describe("handleAnalyzeGuidelineRequest", () => {
  it("requires OPENAI_API_KEY", async () => {
    const response = await handleAnalyzeGuidelineRequest({
      request: buildRequest({ fileUrl: "https://example.com/g.pdf", mimeType: "application/pdf" }),
      env: {},
      fetchImpl: vi.fn() as unknown as typeof fetch
    });

    expect(response.status).toBe(500);
  });

  it("sends a PDF as input_file and returns the extracted summary and colors", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>
      });
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            summary: "สงบ หรูหรา เรียบง่าย",
            primaryColors: ["#1A2B3C", "#FFFFFF", "not-a-color"],
            secondaryColors: ["#00FF00"]
          })
        }),
        { status: 200 }
      );
    });

    const response = await handleAnalyzeGuidelineRequest({
      request: buildRequest({
        fileUrl: "https://example.supabase.co/guideline.pdf",
        mimeType: "application/pdf"
      }),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      ok: boolean;
      summary: string;
      primaryColors: string[];
      secondaryColors: string[];
    };
    expect(payload.ok).toBe(true);
    expect(payload.summary).toBe("สงบ หรูหรา เรียบง่าย");
    expect(payload.primaryColors).toEqual(["#1A2B3C", "#FFFFFF"]);
    expect(payload.secondaryColors).toEqual(["#00FF00"]);

    const content = (calls[0]?.body.input as { content: unknown[] }[])[0]
      ?.content as Record<string, unknown>[];
    expect(content[1]).toMatchObject({
      type: "input_file",
      file_url: "https://example.supabase.co/guideline.pdf"
    });
  });

  it("sends an image as input_image", async () => {
    const calls: { body: Record<string, unknown> }[] = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            summary: "สดใส สนุกสนาน",
            primaryColors: [],
            secondaryColors: []
          })
        }),
        { status: 200 }
      );
    });

    const response = await handleAnalyzeGuidelineRequest({
      request: buildRequest({
        fileUrl: "https://example.supabase.co/guideline.png",
        mimeType: "image/png"
      }),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(200);
    const content = (calls[0]?.body.input as { content: unknown[] }[])[0]
      ?.content as Record<string, unknown>[];
    expect(content[1]).toMatchObject({
      type: "input_image",
      image_url: "https://example.supabase.co/guideline.png"
    });
  });

  it("sends pasted text as input_text instead of a file", async () => {
    const calls: { body: Record<string, unknown> }[] = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            summary: "ตรงไปตรงมา ไม่อ้อมค้อม",
            primaryColors: [],
            secondaryColors: []
          })
        }),
        { status: 200 }
      );
    });

    const response = await handleAnalyzeGuidelineRequest({
      request: buildRequest({ text: "We are bold, direct, and never use jargon." }),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { summary: string };
    expect(payload.summary).toBe("ตรงไปตรงมา ไม่อ้อมค้อม");

    const content = (calls[0]?.body.input as { content: unknown[] }[])[0]
      ?.content as Record<string, unknown>[];
    expect(content[1]).toMatchObject({
      type: "input_text",
      text: "Guideline text:\nWe are bold, direct, and never use jargon."
    });
  });

  it("rejects an empty text field", async () => {
    const response = await handleAnalyzeGuidelineRequest({
      request: buildRequest({ text: "   " }),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: vi.fn() as unknown as typeof fetch
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "text must not be empty."
    });
  });

  it("returns a readable error when OpenAI fails", async () => {
    const fetchMock = vi.fn(async () => new Response("bad", { status: 500 }));

    const response = await handleAnalyzeGuidelineRequest({
      request: buildRequest({
        fileUrl: "https://example.supabase.co/guideline.pdf",
        mimeType: "application/pdf"
      }),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "OpenAI guideline analysis failed: 500"
    });
  });

  it("surfaces OpenAI's own error message on a JSON error body", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              message:
                "Rate limit reached for gpt-5.6-terra in organization org-abc: Limit 3, Used 3. Please try again in 20s.",
              type: "requests",
              code: "rate_limit_exceeded"
            }
          }),
          { status: 429 }
        )
    );

    const response = await handleAnalyzeGuidelineRequest({
      request: buildRequest({
        fileUrl: "https://example.supabase.co/guideline.pdf",
        mimeType: "application/pdf"
      }),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false,
      error:
        "OpenAI guideline analysis failed: Rate limit reached for gpt-5.6-terra in organization org-abc: Limit 3, Used 3. Please try again in 20s."
    });
  });

  it("gives an actionable message for a 429 with no JSON body", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 429 }));

    const response = await handleAnalyzeGuidelineRequest({
      request: buildRequest({
        fileUrl: "https://example.supabase.co/guideline.pdf",
        mimeType: "application/pdf"
      }),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(500);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain("rate limit or quota exceeded (429)");
  });
});
