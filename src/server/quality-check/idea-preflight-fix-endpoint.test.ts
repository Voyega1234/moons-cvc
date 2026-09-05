import { describe, expect, it, vi } from "vitest";
import { handleIdeaPreflightFixRequest } from "./idea-preflight-fix-endpoint";

function fixRequest(overrides: Record<string, unknown> = {}) {
  return new Request("https://moons.local/api/idea-preflight-fix", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      field: "hook",
      check: "quality",
      message: "ข้อความสรุปเกินหลักฐานที่มี ควรเปลี่ยนให้ไม่รับรองผลลัพธ์",
      suggestion: "เปลี่ยนเป็นข้อความที่ไม่รับรองการยื่นได้โดยไม่มีสลิป",
      instructions: "",
      direction: {
        hook: "ไม่มีสลิปเงินเดือน...ก็ยื่นรีไฟแนนซ์ได้",
        subheadline: "เอกสารรายได้ไม่สม่ำเสมอก็ยื่นได้",
        concept: "Flexible income refinance",
        visual: "Person reviewing documents at home",
        cta: "ปรึกษาการยื่นรีไฟแนนซ์",
        caption: "ยื่นง่ายกว่าที่คิด"
      },
      brandPolicies: [],
      brandAvoid: [],
      ...overrides
    })
  });
}

describe("handleIdeaPreflightFixRequest", () => {
  it("asks OpenRouter's Gemini 3.8 Flash to revise only the flagged field", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions");
      const requestBody = JSON.parse(String(init?.body)) as {
        model: string;
        messages: readonly { content: string }[];
      };
      expect(requestBody.model).toBe("google/gemini-3.8-flash");
      expect(requestBody.messages[0]?.content).toContain(
        "Field ที่ต้องแก้: Hook"
      );
      expect(requestBody.messages[0]?.content).toContain(
        "ข้อความสรุปเกินหลักฐานที่มี"
      );

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  revisedText: "ไม่มีสลิปเงินเดือน...ก็ยื่นรีไฟแนนซ์ได้ทันที"
                })
              }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const response = await handleIdeaPreflightFixRequest({
      request: fixRequest(),
      env: { OPENROUTER_API_KEY: "test-openrouter-key" },
      fetchImpl: fetchImpl as typeof fetch
    });
    const payload = (await response.json()) as {
      ok: boolean;
      revisedText: string;
    };

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.revisedText).toBe(
      "ไม่มีสลิปเงินเดือน...ก็ยื่นรีไฟแนนซ์ได้ทันที"
    );
  });

  it("requires OPENROUTER_API_KEY", async () => {
    const response = await handleIdeaPreflightFixRequest({
      request: fixRequest(),
      env: {},
      fetchImpl: vi.fn() as unknown as typeof fetch
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "OPENROUTER_API_KEY is required."
    });
  });

  it("rejects an invalid field", async () => {
    const response = await handleIdeaPreflightFixRequest({
      request: fixRequest({ field: "not-a-field" }),
      env: { OPENROUTER_API_KEY: "test-openrouter-key" },
      fetchImpl: vi.fn() as unknown as typeof fetch
    });

    expect(response.status).toBe(500);
    expect(((await response.json()) as { error: string }).error).toContain(
      "field is invalid"
    );
  });

  it("fails when the agent returns an empty revision", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ revisedText: "  " }) } }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const response = await handleIdeaPreflightFixRequest({
      request: fixRequest(),
      env: { OPENROUTER_API_KEY: "test-openrouter-key" },
      fetchImpl: fetchImpl as typeof fetch
    });

    expect(response.status).toBe(500);
    expect(((await response.json()) as { error: string }).error).toContain(
      "returned an empty result"
    );
  });
});
