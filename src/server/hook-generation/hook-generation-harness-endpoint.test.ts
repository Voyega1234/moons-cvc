import { describe, expect, it, vi } from "vitest";
import { handleHookGenerationHarnessRequest } from "./hook-generation-harness-endpoint";

const requestBody = {
  runId: "run-1",
  brand: {
    id: "convert-cake",
    name: "Convert Cake",
    category: "AI marketing agency"
  },
  service: "single-static",
  quantity: 3,
  brief: "ต้องการ creative เพื่อชวน B2B เข้าร่วม AI SEO webinar",
  attachments: [],
  brandMemory: {
    working: ["ใช้ภาษาไทยตรง ชัด และโยงกับยอดขายได้"],
    avoid: ["หลีกเลี่ยงภาพ luxury หรือ warm vintage"]
  },
  brandLibrary: {
    brand: [
      {
        title: "Positioning",
        description: "ที่ปรึกษา AI marketing สำหรับธุรกิจ B2B"
      }
    ],
    products: [
      {
        title: "AI SEO Strategy Workshop",
        description: "Webinar สำหรับเจ้าของธุรกิจ B2B"
      }
    ],
    docs: [],
    refs: []
  }
};

describe("handleHookGenerationHarnessRequest", () => {
  it("requires a Supabase user token when backend Supabase env is configured", async () => {
    const response = await handleHookGenerationHarnessRequest({
      request: new Request("https://moons.local/api/hook-generation-harness", {
        method: "POST",
        body: JSON.stringify(requestBody)
      }),
      env: {
        OPENAI_API_KEY: "test-key",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: vi.fn() as unknown as typeof fetch
    });

    expect(response.status).toBe(401);
  });

  it("runs web research before generating ranked hook directions", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              overallFinding:
                "B2B teams are actively looking for AI search clarity.",
              references: [
                {
                  name: "AI search behavior",
                  type: "category_signal",
                  whyItMatters: "ช่วยโยงกับปัญหา visibility",
                  brandRelevance: "เกี่ยวกับ AI SEO โดยตรง",
                  evidenceSummary: "มีแหล่งข่าวและรายงานรองรับ",
                  evidenceStrength: "medium"
                }
              ],
              searchQueriesUsed: ["AI SEO Thailand B2B"],
              limitations: "ใช้เป็น context เท่านั้น"
            })
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              directions: [
                {
                  id: "hook-1",
                  hook: "ลูกค้า B2B หาเราเจอบน AI หรือยัง?",
                  concept: "เปิดด้วยคำถามที่โยง visibility กับยอดขาย",
                  why: "ชัดเจนกับ pain ของธุรกิจที่เริ่มเห็น search เปลี่ยน",
                  visual: "Founder มอง search result + AI answer บนจอ",
                  cta: "จองที่นั่ง Webinar",
                  caption: "AI SEO ไม่ใช่เรื่องอนาคตสำหรับ B2B แล้ว",
                  score: 91,
                  reasoning: "brand fit สูงและเห็นภาพง่าย",
                  citations: ["AI search behavior"]
                }
              ]
            })
          }),
          { status: 200 }
        )
      );

    const response = await handleHookGenerationHarnessRequest({
      request: new Request("https://moons.local/api/hook-generation-harness", {
        method: "POST",
        body: JSON.stringify(requestBody)
      }),
      env: {
        OPENAI_API_KEY: "test-key",
        OPENAI_HOOK_GENERATION_MODEL: "gpt-test"
      },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.directions[0]).toMatchObject({
      hook: "ลูกค้า B2B หาเราเจอบน AI หรือยัง?",
      why: "ชัดเจนกับ pain ของธุรกิจที่เริ่มเห็น search เปลี่ยน",
      cta: "จองที่นั่ง Webinar"
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body)
    ) as { tools?: unknown[]; model: string; input: unknown };
    const secondBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body)
    ) as { tools?: unknown[]; input: unknown };

    expect(firstBody.model).toBe("gpt-test");
    expect(firstBody.tools).toEqual([{ type: "web_search_preview" }]);
    expect(JSON.stringify(firstBody.input)).toContain(
      "THAI PROVABLE MOMENT"
    );
    expect(secondBody.tools).toBeUndefined();
    expect(JSON.stringify(secondBody.input)).toContain("AI search behavior");
    expect(JSON.stringify(secondBody.input)).toContain(
      "ต้องการ creative เพื่อชวน B2B"
    );
  });

  it("returns a readable error when OpenAI returns an empty body", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));

    const response = await handleHookGenerationHarnessRequest({
      request: new Request("https://moons.local/api/hook-generation-harness", {
        method: "POST",
        body: JSON.stringify(requestBody)
      }),
      env: {
        OPENAI_API_KEY: "test-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "OpenAI hook harness returned an empty response body."
    });
  });
});
