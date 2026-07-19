import { describe, expect, it, vi } from "vitest";
import { GD_CREATIVE_STRATEGIST_CHECKLIST } from "../../domain/quality-check";
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

function qualityAgentResult({
  gdPassed = true,
  gdScore = 92,
  gdSummary = "องค์ประกอบและงานภาพเรียบร้อย",
  csPassed = true,
  csScore = 90,
  csSummary = "ข้อความและรายละเอียดตรง Brief",
  score = 91,
  summary = "พร้อมสำหรับ human review",
  suggestionTitle = "",
  suggestionDetail = "",
  suggestedHook = ""
}: {
  gdPassed?: boolean;
  gdScore?: number;
  gdSummary?: string;
  csPassed?: boolean;
  csScore?: number;
  csSummary?: string;
  score?: number;
  summary?: string;
  suggestionTitle?: string;
  suggestionDetail?: string;
  suggestedHook?: string;
} = {}) {
  const criterion = (passed: boolean, criterionScore: number, detail: string) => ({
    passed,
    score: criterionScore,
    detail,
    suggestion: passed ? "" : "ปรับให้อ่านง่ายและชัดขึ้น"
  });
  return {
    outputId: "output-1",
    agentName: "Creative Strategist",
    score,
    summary,
    gd: {
      passed: gdPassed,
      score: gdScore,
      summary: gdSummary,
      criteria: Array.from({ length: GD_CREATIVE_STRATEGIST_CHECKLIST.length }, () =>
        criterion(gdPassed, gdScore, gdSummary)
      )
    },
    cs: {
      passed: csPassed,
      score: csScore,
      summary: csSummary,
      criteria: Array.from({ length: 3 }, () =>
        criterion(csPassed, csScore, csSummary)
      )
    },
    suggestion: {
      title: suggestionTitle,
      detail: suggestionDetail,
      suggestedHook
    }
  };
}

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
                qualityAgentResult({
                  gdPassed: false,
                  gdScore: 72,
                  gdSummary: "ข้อความในภาพอ่านไม่ชัด",
                  csSummary: "Key Message และราคาตรงกับ Brief",
                  score: 81,
                  summary: "แนวคิดดี แต่ต้องปรับความชัดของข้อความ",
                  suggestionTitle: "เพิ่มความชัดของข้อความ",
                  suggestionDetail: "เพิ่ม contrast และลดข้อความใน first frame",
                  suggestedHook: "Flowers that soften the room instantly"
                })
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
      expect.objectContaining({
        outputId: "output-1",
        gdPassed: false,
        gdReason: "ข้อความในภาพอ่านไม่ชัด",
        csPassed: true,
        csReason: "Key Message และราคาตรงกับ Brief",
        passed: false,
        reason:
          "GD ต้องแก้: ข้อความในภาพอ่านไม่ชัด\nCS ผ่าน: Key Message และราคาตรงกับ Brief",
        report: expect.objectContaining({
          agentName: "Creative Strategist",
          score: 81,
          summary: "แนวคิดดี แต่ต้องปรับความชัดของข้อความ",
          suggestion: {
            title: "เพิ่มความชัดของข้อความ",
            detail: "เพิ่ม contrast และลดข้อความใน first frame",
            suggestedHook: "Flowers that soften the room instantly"
          }
        })
      })
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
    expect(prompt).toContain("ความสวยงามและความพร้อมใช้งานจริง (Visual Quality)");
    expect(prompt).toContain("Stop-scroll & Brand Impact Audit");
    expect(prompt).toContain("ภาพนี้ดีพอให้กลุ่มเป้าหมายหยุดดู");
    expect(prompt).toContain("Stop-scroll verdict: Strong");
    expect(prompt).toContain("Brand perception: Risk");
    expect(prompt).toContain("Hierarchy, Emphasis, Dominance & Movement");
    expect(prompt).toContain("Lighting, Shadow & Material Realism");
    expect(prompt).toContain("งานนี้ดูออกว่าทำจาก AI หรือไม่?");
    expect(prompt).toContain("AI-origin verdict: Looks AI-generated");
    expect(prompt).toContain("contact shadow");
    expect(prompt).toContain("Balance, Contrast, Emphasis, Movement");
    expect(prompt).toContain("งานต้อง image-led และอ่านได้บนมือถือ");
    expect(prompt).toContain("Agent name: Creative Strategist");
    expect(prompt).toContain("first-time scroller");
    expect(prompt).toContain("Bottom Funnel");
    expect(prompt).toContain("Claim Accuracy Check");
    expect(prompt).toContain("ผลลัพธ์สำหรับ UI ต้องสั้นและไม่ซ้ำกัน");
    expect(prompt).toContain("มีเฉพาะ Top 3 Actionable Recs");
    expect(prompt).toContain("ข้อความใน Artwork");
    expect(prompt).toContain("Key Message ชัด และตรง Brief / Objective");
    expect(prompt).not.toContain(
      "งานตรง Client Context หรือ Revision Feedback ถ้าเป็นงานแก้"
    );
    expect(prompt).toContain("Brand: Petal House");
    expect(prompt).toContain("Caption: Summer bouquet, THB 990.");
    expect(prompt).toContain("Revision Feedback: CS: Keep the price visible.");
  });

  it("fails GD when any mandatory visual criterion detects an AI tell", async () => {
    const agentResult = qualityAgentResult({
      gdPassed: true,
      gdScore: 84,
      gdSummary: "ภาพรวมดีแต่มีจุดที่ต้อง retouch",
      score: 86,
      summary: "ต้องเก็บ production finish อีกหนึ่งจุด"
    });
    const aiOriginIndex = GD_CREATIVE_STRATEGIST_CHECKLIST.findIndex((item) =>
      item.includes("AI-origin Audit")
    );
    if (aiOriginIndex < 0) throw new Error("AI-origin criterion is missing.");
    agentResult.gd.criteria[aiOriginIndex] = {
      passed: false,
      score: 58,
      detail:
        "AI-origin verdict: Looks AI-generated เพราะเงาไม่สัมผัสพื้นและวัสดุเป็นพลาสติก",
      suggestion: "เพิ่ม contact shadow และแก้ผิววัสดุให้สมจริง"
    };

    const fetchMock = vi.fn(
      async (url: string | URL | Request, _init?: RequestInit) => {
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
            output_text: JSON.stringify({ results: [agentResult] })
          }),
          { status: 200 }
        );
      }
    );

    const response = await handleQualityCheckRequest({
      request: buildRequest(),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch
    });
    const payload = (await response.json()) as {
      results: { gdPassed: boolean; passed: boolean }[];
    };

    expect(response.status).toBe(200);
    expect(payload.results[0]).toEqual(
      expect.objectContaining({ gdPassed: false, passed: false })
    );
  });

  it("fails GD when the artwork is weak at stop-scroll or risks brand perception", async () => {
    const agentResult = qualityAgentResult({
      gdPassed: true,
      gdScore: 82,
      gdSummary: "ภาพอ่านได้แต่ยังไม่สร้างความสนใจหรือความน่าเชื่อถือ",
      score: 83,
      summary: "ต้องยกระดับ visual hook และ brand impression"
    });
    const brandImpactIndex = GD_CREATIVE_STRATEGIST_CHECKLIST.findIndex((item) =>
      item.includes("Stop-scroll & Brand Impact Audit")
    );
    if (brandImpactIndex < 0) {
      throw new Error("Stop-scroll & Brand Impact criterion is missing.");
    }
    agentResult.gd.criteria[brandImpactIndex] = {
      passed: false,
      score: 54,
      detail:
        "Stop-scroll verdict: Weak; Brand perception: Risk เพราะภาพดู generic และมีร่องรอย AI ที่ลดความน่าเชื่อถือ",
      suggestion:
        "เปลี่ยน visual hook ให้เฉพาะกับแบรนด์และ retouch จุดที่ดูเป็น AI ให้เป็นงาน production จริง"
    };

    const fetchMock = vi.fn(
      async (url: string | URL | Request, _init?: RequestInit) => {
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
            output_text: JSON.stringify({ results: [agentResult] })
          }),
          { status: 200 }
        );
      }
    );

    const response = await handleQualityCheckRequest({
      request: buildRequest(),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch
    });
    const payload = (await response.json()) as {
      results: { gdPassed: boolean; passed: boolean }[];
    };

    expect(response.status).toBe(200);
    expect(payload.results[0]).toEqual(
      expect.objectContaining({ gdPassed: false, passed: false })
    );
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
              qualityAgentResult()
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
