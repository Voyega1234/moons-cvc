import { describe, expect, it, vi } from "vitest";
import {
  buildHookGenerationBatches,
  handleHookGenerationHarnessRequest
} from "./hook-generation-harness-endpoint";
import type { HookGenerationHarnessRequest } from "../../services/creative-generation/harness-hook-generation";
import type { PastPostsClient } from "./past-posts";

const requestBody = {
  runId: "run-1",
  hookIdeaMode: "fresh-research",
  brand: {
    id: "convert-cake",
    name: "Convert Cake",
    category: "AI marketing agency"
  },
  service: "single-static",
  quantity: 6,
  contentTypeQuotas: [
    { service: "single-static", count: 3 },
    { service: "album-post", count: 1 },
    { service: "ugc-video", count: 2 }
  ],
  brief: "ต้องการ creative เพื่อชวน B2B เข้าร่วม AI SEO webinar",
  onboardingQuestionnaire:
    "ข้อมูลตอน Onboarding: ลูกค้าหลักเป็นเจ้าของธุรกิจ B2B ที่เริ่มใช้ AI",
  attachments: [],
  uploadedMaterials: [
    {
      id: "material-1",
      name: "hero-bottle.png",
      mediaType: "image/png",
      role: "main-object",
      description: "Keep the bottle as the hero object",
      url: "https://example.com/hero-bottle.png"
    }
  ],
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

function highlightResponse(id: string, highlights: readonly string[]) {
  return new Response(
    JSON.stringify({
      output_text: JSON.stringify({
        items: [{ id, highlights }]
      })
    }),
    { status: 200 }
  );
}

describe("handleHookGenerationHarnessRequest", () => {
  it("splits high-volume hook quotas into bounded, content-specific batches", () => {
    const batches = buildHookGenerationBatches({
      ...requestBody,
      service: "single-static",
      uploadedMaterials: requestBody.uploadedMaterials.map((material) => ({
        ...material,
        role: "main-object" as const
      })),
      hookIdeaMode: "fresh-research",
      extraInstructions: "",
      existingHooks: [],
      quantity: 104,
      contentTypeQuotas: [
        { service: "single-static", count: 52 },
        { service: "album-post", count: 52 }
      ]
    } satisfies HookGenerationHarnessRequest);

    expect(batches.map((batch) => batch.quantity)).toEqual([
      12,
      12,
      12,
      12,
      4,
      12,
      12,
      12,
      12,
      4
    ]);
    expect(batches.every((batch) => batch.contentTypeQuotas.length === 1)).toBe(
      true
    );
    expect(batches[0]?.extraInstructions).toContain("batch 1/10");
  });

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
                  service: "single-static",
                  hook: "ลูกค้า B2B หาเราเจอบน AI หรือยัง?",
                  subheadline: "เปลี่ยน visibility กับยอดขายให้ชัดขึ้น",
                  concept: "เปิดด้วยคำถามที่โยง visibility กับยอดขาย",
                  subheadlineHighlight: "visibility กับยอดขาย",
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
      )
      .mockResolvedValueOnce(
        highlightResponse("hook-1", ["visibility กับยอดขาย"])
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
      subheadline: "เปลี่ยน visibility กับยอดขายให้ชัดขึ้น",
      subheadlineHighlight: "visibility กับยอดขาย",
      why: "ชัดเจนกับ pain ของธุรกิจที่เริ่มเห็น search เปลี่ยน",
      cta: "จองที่นั่ง Webinar"
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const firstBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body)
    ) as { tools?: unknown[]; model: string; input: unknown };
    const secondBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body)
    ) as { tools?: unknown[]; model: string; input: unknown };
    const thirdBody = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body)
    ) as {
      model: string;
      input: { content: { text: string }[] }[];
      text: { format: { name: string } };
    };

    expect(firstBody.model).toBe("gpt-5.6-luna");
    expect(firstBody.tools).toEqual([{ type: "web_search_preview" }]);
    expect(secondBody.model).toBe("gpt-test");
    expect(thirdBody.model).toBe("gpt-5.6-luna");
    expect(JSON.stringify(firstBody.input)).toContain(
      "THAI PROVABLE MOMENT"
    );
    expect(JSON.stringify(firstBody.input)).toContain(
      "HISTORICAL ONBOARDING CONTEXT ONLY"
    );
    expect(secondBody.tools).toBeUndefined();
    expect(JSON.stringify(secondBody.input)).toContain("AI search behavior");
    expect(JSON.stringify(secondBody.input)).toContain(
      "ต้องการ creative เพื่อชวน B2B"
    );
    expect(JSON.stringify(secondBody.input)).toContain(
      "ข้อมูลตอน Onboarding: ลูกค้าหลักเป็นเจ้าของธุรกิจ B2B"
    );
    expect(JSON.stringify(secondBody.input)).toContain(
      "NOT A CURRENT CAMPAIGN BRIEF"
    );
    expect(JSON.stringify(secondBody.input)).toContain(
      "CONTENT TYPE CREATIVE RULES"
    );
    expect(JSON.stringify(secondBody.input)).toContain(
      "Return exactly 6 directions matching this quota exactly"
    );
    expect(JSON.stringify(secondBody.input)).toContain("ALBUM AD");
    expect(JSON.stringify(secondBody.input)).toContain("UGC VIDEO");
    expect(JSON.stringify(secondBody.input)).toContain(
      "caption and cta must never contain 'ครับ' or 'ค่ะ'"
    );
    expect(JSON.stringify(secondBody.input)).not.toContain(
      "subheadlineHighlight"
    );
    expect(JSON.stringify(secondBody.input)).toContain(
      "subheadline = copywriting.sub_headline_1"
    );
    expect(JSON.stringify(secondBody.input)).toContain(
      "one concise Thai sentence"
    );
    expect(JSON.stringify(secondBody.input)).toContain(
      "album-post: คิดเป็น swipeable story"
    );
    expect(JSON.stringify(secondBody.input)).toContain(
      "3 supporting topics"
    );
    expect(JSON.stringify(secondBody.input)).toContain(
      "ugc-video: คิดเป็น creator-led vertical video"
    );
    expect(JSON.stringify(secondBody.input)).toContain(
      "openingScript = คำพูด+action+ข้อความบนจอ"
    );
    expect(JSON.stringify(secondBody.input)).toContain("ugcBrief");
    expect(JSON.stringify(secondBody.input)).toContain(
      "single-static: รักษามาตรฐานเดิม"
    );
    expect(JSON.stringify(secondBody.input)).toContain("formatBeats");
    expect(JSON.stringify(secondBody.input)).toContain(
      "hero-bottle.png | role=main-object"
    );
    expect(JSON.stringify(secondBody.input)).toContain(
      '"type":"input_image"'
    );
    expect(JSON.stringify(secondBody.input)).toContain(
      "https://example.com/hero-bottle.png"
    );
    expect(JSON.stringify(secondBody.input)).not.toContain("$('Webhook')");
    const highlightPrompt = thirdBody.input[0]?.content[0]?.text ?? "";
    expect(thirdBody.text.format.name).toBe("neo_subheadline_highlights");
    expect(highlightPrompt).toContain(
      "Bold the sentence of this text that you think it's a highlight of this sub-headline"
    );
    expect(highlightPrompt).toContain(
      "Use exact text spans from subheadline. Do not rewrite."
    );
    expect(highlightPrompt).toContain(
      '"subheadline": "เปลี่ยน visibility กับยอดขายให้ชัดขึ้น"'
    );
  });

  it("runs web research in Standard mode", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              overallFinding: "A current category signal is relevant.",
              references: [],
              searchQueriesUsed: ["current category signal"],
              limitations: "Use as supporting context only."
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
                  id: "hook-standard",
                  service: "single-static",
                  hook: "เริ่มจากปัญหาที่ลูกค้าเจอจริง",
                  subheadline: "ใช้ข้อมูลแบรนด์และบรีฟโดยไม่ค้นเว็บ",
                  concept: "Standard brand-led idea",
                  why: "Uses supplied context only",
                  visual: "Clean and direct",
                  cta: "ดูรายละเอียด",
                  caption: "เริ่มจากข้อมูลที่แบรนด์ยืนยันแล้ว",
                  score: 85,
                  reasoning: "Strong brand fit",
                  citations: []
                }
              ]
            })
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(highlightResponse("hook-standard", []));

    const response = await handleHookGenerationHarnessRequest({
      request: new Request("https://moons.local/api/hook-generation-harness", {
        method: "POST",
        body: JSON.stringify({ ...requestBody, hookIdeaMode: "standard" })
      }),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const researchBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body)
    ) as { tools?: unknown[]; input: unknown };
    expect(researchBody.tools).toEqual([{ type: "web_search_preview" }]);
  });

  it("includes real past post captions as a style reference for caption writing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ email: "team@convertcake.com" }), {
          status: 200
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              overallFinding: "No strong seasonal moment found.",
              references: [],
              searchQueriesUsed: [],
              limitations: "Limited public data."
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
                  service: "single-static",
                  hook: "ลูกค้า B2B หาเราเจอบน AI หรือยัง?",
                  subheadline: "เปลี่ยน visibility กับยอดขายให้ชัดขึ้น",
                  concept: "เปิดด้วยคำถามที่โยง visibility กับยอดขาย",
                  subheadlineHighlight: "visibility กับยอดขาย",
                  why: "ชัดเจนกับ pain ของธุรกิจที่เริ่มเห็น search เปลี่ยน",
                  visual: "Founder มอง search result + AI answer บนจอ",
                  cta: "จองที่นั่ง Webinar",
                  caption: "AI SEO ไม่ใช่เรื่องอนาคตสำหรับ B2B แล้ว",
                  score: 91,
                  reasoning: "brand fit สูงและเห็นภาพง่าย",
                  citations: []
                }
              ]
            })
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        highlightResponse("hook-1", ["visibility กับยอดขาย"])
      );

    const fakePastPostsClient: PastPostsClient = {
      schema() {
        return {
          from(table: string) {
            return {
              select() {
                return {
                  eq() {
                    return {
                      order() {
                        return {
                          async limit() {
                            if (table === "brand_social_posts") {
                              return {
                                data: [
                                  {
                                    text: "จองด่วน! Workshop AI SEO รอบนี้ที่นั่งจำกัด 🔥 ทักแชทเลย"
                                  }
                                ],
                                error: null
                              };
                            }
                            return { data: [], error: null };
                          }
                        };
                      }
                    };
                  }
                };
              }
            };
          }
        };
      }
    };

    const response = await handleHookGenerationHarnessRequest({
      request: new Request("https://moons.local/api/hook-generation-harness", {
        method: "POST",
        headers: { authorization: "Bearer user-token" },
        body: JSON.stringify(requestBody)
      }),
      env: {
        OPENAI_API_KEY: "test-key",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      createPastPostsClient: () => fakePastPostsClient
    });

    expect(response.status).toBe(200);

    const generationBody = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body)
    ) as { input: unknown };
    expect(JSON.stringify(generationBody.input)).toContain(
      "จองด่วน! Workshop AI SEO รอบนี้ที่นั่งจำกัด"
    );
    expect(JSON.stringify(generationBody.input)).toContain(
      "copywriter ประจำเพจนี้"
    );
    expect(JSON.stringify(generationBody.input)).toContain(
      "หา pattern ที่เกิดซ้ำ"
    );
    expect(JSON.stringify(generationBody.input)).toContain(
      "ห้ามใช้ CTA กว้างๆ"
    );
    expect(JSON.stringify(generationBody.input)).toContain(
      "contactLine = recurring verified contact/footer"
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

  it("tells the model about extra instructions and existing hooks to avoid duplicates", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              overallFinding: "No strong seasonal moment found.",
              references: [],
              searchQueriesUsed: [],
              limitations: "Limited public data."
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
                  id: "hook-2",
                  service: "single-static",
                  hook: "มุมใหม่ที่ยังไม่เคยพูดถึง",
                  subheadline: "สนับสนุนมุมใหม่โดยไม่ซ้ำเดิม",
                  concept: "Different angle",
                  subheadlineHighlight: "มุมใหม่",
                  why: "Distinct from the previous batch",
                  visual: "Clean, modern.",
                  cta: "ดูรายละเอียด",
                  caption: "แคปชั่นใหม่",
                  score: 88,
                  reasoning: "Avoids repeating the earlier hook",
                  citations: []
                }
              ]
            })
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        highlightResponse("hook-2", [])
      );

    const response = await handleHookGenerationHarnessRequest({
      request: new Request("https://moons.local/api/hook-generation-harness", {
        method: "POST",
        body: JSON.stringify({
          ...requestBody,
          extraInstructions: "เน้นกลุ่มเจ้าของธุรกิจขนาดเล็กรอบนี้",
          existingHooks: [
            { hook: "ลูกค้า B2B หาเราเจอบน AI หรือยัง?", concept: "Visibility question" }
          ]
        })
      }),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.directions[0]?.subheadlineHighlight).toBe("");

    const generationBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body)
    ) as { input: unknown };
    const generationPrompt = JSON.stringify(generationBody.input);
    expect(generationPrompt).toContain("เน้นกลุ่มเจ้าของธุรกิจขนาดเล็กรอบนี้");
    expect(generationPrompt).toContain("ลูกค้า B2B หาเราเจอบน AI หรือยัง?");
    expect(generationPrompt).toContain("DO NOT repeat");
  });
});
