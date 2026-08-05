import { describe, expect, it, vi } from "vitest";
import {
  buildHookGenerationBatches,
  handleHookGenerationHarnessRequest
} from "./hook-generation-harness-endpoint";
import type { HookGenerationHarnessRequest } from "../../services/creative-generation/harness-hook-generation";
import type { HookGenerationDebugLog } from "./hook-generation-debug-log";
import type { PastPostsClient } from "./past-posts";

const requestBody = {
  runId: "run-1",
  hookIdeaMode: "fresh-research",
  albumFormat: "auto" as const,
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
  extraInstructions:
    "Creative mix quota: Single static × 3. Generate 6 hook candidates in total.\nPrimary success metric: CTR.",
  attachments: ["launch-questionnaire.pdf"],
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
        description:
          "ที่ปรึกษา AI marketing สำหรับธุรกิจ B2B\nSource: brand_analysis_jobs/test-job · 1 image"
      },
      {
        title: "Visual guidance",
        description: "Use a blue gradient, Karla typography, and a 12-column layout."
      },
      {
        title: "Logo",
        description: "Minimum digital width is 80 px."
      }
    ],
    products: [
      {
        title: "AI SEO Strategy Workshop",
        description: "Webinar สำหรับเจ้าของธุรกิจ B2B"
      }
    ],
    docs: [
      {
        title: "Brand guideline",
        description: "Logo sizing, typography, colour system, and stationery."
      },
      {
        title: "Product FAQ",
        description: "The workshop is designed for B2B marketing teams."
      }
    ],
    refs: [
      {
        title: "Screenshot 2026-08-03.png",
        description: "Reference screenshot file."
      }
    ]
  }
};

const singleStaticRequestBody = {
  ...requestBody,
  quantity: 1,
  contentTypeQuotas: [{ service: "single-static" as const, count: 1 }]
};

const singleUgcRequestBody = {
  ...requestBody,
  service: "ugc-video" as const,
  quantity: 1,
  contentTypeQuotas: [{ service: "ugc-video" as const, count: 1 }]
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


function openAiUgcDirectionResponse(hook: string) {
  return new Response(
    JSON.stringify({
      output_text: JSON.stringify({
        directions: [
          {
            id: "ugc-natural-thai",
            sourceCandidateId: "candidate-1-14",
            service: "ugc-video",
            hook,
            subheadline: "เลือกจากสิ่งที่ใช้จริงในครัว",
            concept: "รีวิวการเลือกกระทะจากการใช้งานจริง",
            why: "เป็นภาษาพูดที่เข้าใจง่าย",
            visual: "Creator สาธิตสินค้าในครัวจริง",
            cta: "ทักถามรุ่นกระทะ",
            albumFormat: "three-horizontal",
            formatBeats: [
              "หยิบสินค้าขึ้นมาระหว่างทำอาหาร",
              "เล่าจากสิ่งที่สังเกตเห็นจริง",
              "เปลี่ยนมุมกล้องตามการใช้งาน",
              "จบเมื่อเรื่องเล่าสมบูรณ์"
            ],
            caption: `${hook}\n\nเลือกกระทะจากการใช้งานจริง`,
            score: 90,
            reasoning: "ภาษาธรรมชาติและเห็นภาพ",
            citations: []
          }
        ]
      })
    }),
    { status: 200 }
  );
}

function openAiAlbumDirectionResponse(formatBeats: readonly string[]) {
  return new Response(
    JSON.stringify({
      output_text: JSON.stringify({
        directions: [
          {
            id: "album-panel-count",
            sourceCandidateId: "direct-01",
            service: "album-post",
            hook: "เด็กหลับแล้ว ทริปของผู้ใหญ่ยังไม่ต้องจบ",
            subheadline: "พื้นที่ที่แยกกันช่วยให้ทุกคนพักได้ตามจังหวะ",
            concept: "After Bedtime",
            why: "ใช้พื้นที่หลาย panel เพื่อเล่าโมเมนต์ครอบครัว",
            visual: "ภาพครอบครัวใช้พื้นที่แยกกันอย่างเป็นธรรมชาติ",
            cta: "ดูรายละเอียดห้องพัก",
            albumFormat: "four-grid",
            formatBeats,
            caption: "ห้องพักที่ให้ทุกคนมีพื้นที่ตามจังหวะของตัวเอง",
            score: 90,
            reasoning: "เหมาะกับครอบครัวและรูปแบบ Album",
            citations: []
          }
        ]
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

  it("uses one research-enabled pass to return final directions", async () => {
    const writeDebugLog = vi.fn(
      async (_directory: string, _entry: HookGenerationDebugLog) => undefined
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              directions: [
                {
                  id: "hook-1",
                  sourceCandidateId: "direct-01",
                  service: "single-static",
                  hook: "ลูกค้า B2B หาเราเจอบน AI หรือยัง?",
                  subheadline: "เปลี่ยน visibility กับยอดขายให้ชัดขึ้น",
                  concept: "เปิดด้วยคำถามที่โยง visibility กับยอดขาย",
                  why: "ชัดเจนกับ pain ของธุรกิจที่เริ่มเห็น search เปลี่ยน",
                  visual: "Founder มอง search result + AI answer บนจอ",
                  albumFormat: "three-horizontal",
                  cta: "จองที่นั่ง Webinar",
                  caption: "AI SEO ไม่ใช่เรื่องอนาคตสำหรับ B2B แล้ว",
                  score: 91,
                  reasoning: "Brand truth, ownership, parity และเหตุผลผลิตครบ",
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
        body: JSON.stringify(singleStaticRequestBody)
      }),
      env: {
        OPENAI_API_KEY: "test-key",
        OPENAI_HOOK_GENERATION_MODEL: "gpt-test",
        HOOK_GENERATION_DEBUG_LOG_DIR: "logs/hook-generation"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      loadAgentHookPrompt: async () =>
        "# CREATIVE STRATEGIST\nAGENT_HOOK_SEARCH_POLICY_ONLY",
      writeDebugLog
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const generationBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body)
    ) as {
      tools?: unknown[];
      tool_choice?: string;
      reasoning?: { effort?: string };
      input: unknown;
    };
    expect(generationBody.tools).toEqual([expect.objectContaining({ type: "web_search_preview" })]);
    expect(generationBody.tool_choice).toBe("required");
    expect(generationBody.reasoning).toEqual({ effort: "high" });
    const supportBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body)
    ) as { reasoning?: unknown };
    expect(supportBody.reasoning).toBeUndefined();
    const prompt = JSON.stringify(generationBody.input);
    expect(prompt).toContain("ONE CREATIVE PASS — FINISHED OPTIONS ONLY");
    expect(prompt).toContain("AGENT_HOOK_SEARCH_POLICY_ONLY");
    expect(prompt).toContain("Research status: enabled");
    expect(prompt).toContain("ทำตาม ## Research ใน agent_hook.md");
    expect(prompt).not.toContain("Research เป็นวัตถุดิบ ไม่ใช่สูตรคอนเทนต์");
    expect(prompt).toContain("Format เป็นข้อกำหนดการผลิต ไม่ใช่ Creative Framework");
    expect(prompt).not.toContain("strategic territory");
    expect(prompt).not.toContain("90–100 ใช้ได้เฉพาะ idea");
    expect(prompt).toContain("Onboarding Questionnaire — standing brand context");
    expect(prompt).not.toContain("# Divergent ideation");
    expect(prompt).not.toContain("Candidate pool");
    const debugEntry = writeDebugLog.mock.calls[0]?.[1];
    expect(debugEntry?.hookAgent.batches[0]?.request.tools).toEqual([
      expect.objectContaining({ type: "web_search_preview" })
    ]);
    expect(
      debugEntry?.hookAgent.batches[0]?.request.reasoningEffort
    ).toBe("high");
    expect(debugEntry?.finalResponse).toMatchObject({
      directions: [expect.objectContaining({ id: "hook-1" })]
    });
  });

  it("defaults requests without a Hook idea mode to required Thailand research", async () => {
    const bodyWithoutMode = { ...singleStaticRequestBody } as Record<
      string,
      unknown
    >;
    delete bodyWithoutMode.hookIdeaMode;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              directions: [
                {
                  id: "default-research",
                  sourceCandidateId: "direct-01",
                  service: "single-static",
                  hook: "มุมใหม่จากข้อมูลที่ค้นก่อนคิด",
                  subheadline: "ใช้บริบทไทยประกอบ Direction",
                  concept: "Research-backed direction",
                  why: "Relevant to the current audience",
                  visual: "Brand-specific visual",
                  cta: "ดูรายละเอียด",
                  supportingPoints: [],
                  formatBeats: [],
                  caption: "พัฒนาแนวคิดจากข้อมูลที่เกี่ยวข้องกับโจทย์",
                  score: 88,
                  reasoning: "เหมาะกับ Brief และแบรนด์",
                  citations: []
                }
              ]
            })
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(highlightResponse("default-research", []));

    const response = await handleHookGenerationHarnessRequest({
      request: new Request("https://moons.local/api/hook-generation-harness", {
        method: "POST",
        body: JSON.stringify(bodyWithoutMode)
      }),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(200);
    const generationBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body)
    ) as { tools?: unknown[]; tool_choice?: string; input: unknown };
    expect(generationBody.tools).toEqual([
      expect.objectContaining({ type: "web_search_preview" })
    ]);
    expect(generationBody.tool_choice).toBe("required");
    expect(JSON.stringify(generationBody.input)).toContain(
      "Hook idea mode: fresh-research"
    );
  });

  it("keeps Standard mode on verified context without web research", async () => {
    const writeDebugLog = vi.fn(
      async (_directory: string, _entry: HookGenerationDebugLog) => undefined
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
                            return table === "brand_social_posts"
                              ? {
                                  data: [
                                    {
                                      text: "พูดตรงถึงปัญหาธุรกิจ แล้วเว้นบรรทัดก่อน CTA"
                                    }
                                  ],
                                  error: null
                                }
                              : { data: [], error: null };
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
              directions: [
                {
                  id: "hook-standard",
                  sourceCandidateId: "direct-01",
                  service: "single-static",
                  hook: "เริ่มจากปัญหาที่ลูกค้าเจอจริง",
                  subheadline: "ใช้ข้อมูลแบรนด์และบรีฟโดยไม่ค้นเว็บ",
                  concept: "Standard brand-led idea",
                  why: "Uses supplied context only",
                  visual: "Clean and direct",
                  albumFormat: "three-horizontal",
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
        headers: { authorization: "Bearer user-token" },
        body: JSON.stringify({
          ...requestBody,
          hookIdeaMode: "standard",
          quantity: 1,
          contentTypeQuotas: [{ service: "single-static", count: 1 }],
          brief:
            "Launch Questionnaire\nPlease complete the questionnaire below.\nAbout Your Business\nProducts, Customers & Competitors"
        })
      }),
      env: {
        OPENAI_API_KEY: "test-key",
        HOOK_GENERATION_DEBUG_LOG_DIR: "logs/hook-generation",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      createPastPostsClient: () => fakePastPostsClient,
      loadAgentHookPrompt: async () =>
        "# AGENT HOOK\nSEARCH_POLICY_FROM_AGENT_HOOK",
      writeDebugLog
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const generationBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body)
    ) as {
      tools?: unknown[];
      tool_choice?: string;
      input: unknown;
      text: { format: { name: string } };
    };
    expect(generationBody.tools).toBeUndefined();
    expect(generationBody.tool_choice).toBeUndefined();
    expect(generationBody.text.format.name).toBe("moons_hook_generation");
    const generationPrompt = JSON.stringify(generationBody.input);
    expect(generationPrompt).toContain("SEARCH_POLICY_FROM_AGENT_HOOK");
    expect(generationPrompt).toContain("Hook idea mode: standard");
    expect(generationPrompt).toContain(
      "ไม่มี Current Campaign Brief แยกจากข้อมูล Onboarding"
    );
    expect(generationPrompt).not.toContain("Please complete the questionnaire");
    expect(generationPrompt).not.toContain("Products, Customers & Competitors");
    expect(generationPrompt).not.toContain("# Search — required");
    expect(generationPrompt).not.toContain("STANDARD MODE:");
    expect(generationPrompt).not.toContain("THAILAND FIRST");
    expect(generationPrompt).toContain("ONE CREATIVE PASS — FINISHED OPTIONS ONLY");
    expect(generationPrompt).toContain(
      "Onboarding Questionnaire — standing brand context"
    );
    expect(generationPrompt).toContain(
      "ข้อมูลตอน Onboarding: ลูกค้าหลักเป็นเจ้าของธุรกิจ B2B"
    );
    expect(generationPrompt).toContain("# Past posts — direct brand evidence");
    expect(generationPrompt).toContain(
      "พูดตรงถึงปัญหาธุรกิจ แล้วเว้นบรรทัดก่อน CTA"
    );
    expect(generationPrompt).toContain("Past posts ไม่ใช่ตัวอย่างที่ต้องทำตาม");
    expect(generationPrompt).toContain(
      "เลือกภาษา น้ำเสียง ความยาว จังหวะ และระดับการขาย"
    );
    expect(generationPrompt).not.toContain("ทำ Oral Copy Gate ก่อนส่งทุก Hook");
    expect(generationPrompt).not.toContain(
      "ตอบภาษาไทย ยกเว้นชื่อแบรนด์"
    );
    expect(generationPrompt).toContain("directions ที่ผลิตต่อได้จริงครบตาม quota");
    expect(generationPrompt).not.toContain("Category parity:");
    expect(generationPrompt).not.toContain("strategic territory");
    expect(generationPrompt).not.toContain("ห้ามให้ 90+ เพื่อเติม quota");
    expect(generationPrompt).not.toContain("# Divergent ideation");
    expect(generationPrompt).not.toContain("Candidate pool");
    expect(writeDebugLog).toHaveBeenCalledTimes(1);
    const debugEntry = writeDebugLog.mock.calls[0]?.[1];
    expect(debugEntry?.hookAgent.batches[0]?.request.inputText).toContain(
      "ONE CREATIVE PASS — FINISHED OPTIONS ONLY"
    );
    expect(debugEntry?.hookAgent.batches[0]?.request.attachedImages).toEqual([
      expect.objectContaining({ name: "hero-bottle.png", detail: "high" })
    ]);
  });

  it("rewrites a final Thai direction when its copy uses ฉัน", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(openAiUgcDirectionResponse("ฉันเลือกจากการใช้งานจริง"))
      .mockResolvedValueOnce(openAiUgcDirectionResponse("เลือกจากการใช้งานจริง"))
      .mockResolvedValueOnce(highlightResponse("ugc-natural-thai", []));

    const response = await handleHookGenerationHarnessRequest({
      request: new Request("https://moons.local/api/hook-generation-harness", {
        method: "POST",
        body: JSON.stringify(singleUgcRequestBody)
      }),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const directionRetryBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body)
    ) as { input: unknown };
    expect(JSON.stringify(directionRetryBody.input)).toContain(
      "THAI NATURALNESS CORRECTION"
    );
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("ฉัน");
    expect(body).toMatchObject({
      directions: [expect.objectContaining({ formatBeats: expect.any(Array) })]
    });
    expect((body as { directions: { formatBeats: string[] }[] }).directions[0]?.formatBeats).toHaveLength(4);
  });

  it("retries an album direction when formatBeats does not match four-grid", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        openAiAlbumDirectionResponse(["Panel 2", "Panel 3"])
      )
      .mockResolvedValueOnce(
        openAiAlbumDirectionResponse(["Panel 2", "Panel 3", "Panel 4"])
      )
      .mockResolvedValueOnce(
        highlightResponse("album-panel-count", [])
      );

    const response = await handleHookGenerationHarnessRequest({
      request: new Request("https://moons.local/api/hook-generation-harness", {
        method: "POST",
        body: JSON.stringify({
          ...requestBody,
          service: "album-post",
          quantity: 1,
          contentTypeQuotas: [{ service: "album-post", count: 1 }]
        })
      }),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const retryBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body)
    ) as { input: unknown; reasoning?: { effort?: string } };
    const retryPrompt = JSON.stringify(retryBody.input);
    expect(retryPrompt).toContain("ALBUM PANEL COUNT CORRECTION");
    expect(retryPrompt).toContain(
      "directions[0].formatBeats must contain exactly 3 items for four-grid"
    );
    expect(retryBody.reasoning).toEqual({ effort: "high" });
    const payload = (await response.json()) as {
      directions: { formatBeats: string[] }[];
    };
    expect(payload.directions[0]?.formatBeats).toHaveLength(3);
  });

  it("routes the direct creative pass through OpenRouter when selected", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    directions: [
                      {
                        id: "openrouter-hook",
                        sourceCandidateId: "candidate-1",
                        service: "single-static",
                        hook: "มุมคิดใหม่จาก Claude",
                        subheadline: "ยังคงใช้ brief และ brand context ชุดเดิม",
                        concept: "OpenRouter generation",
                        why: "Tests provider routing",
                        visual: "Clean and direct",
                        albumFormat: "three-horizontal",
                        cta: "ดูรายละเอียด",
                        caption: "แคปชั่นจากโมเดลที่เลือก",
                        score: 88,
                        reasoning: "Strong fit",
                        citations: []
                      }
                    ]
                  })
                }
              }
            ]
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(highlightResponse("openrouter-hook", []));

    const response = await handleHookGenerationHarnessRequest({
      request: new Request("https://moons.local/api/hook-generation-harness", {
        method: "POST",
        body: JSON.stringify({
          ...singleStaticRequestBody,
          generationModel: "anthropic/claude-sonnet-4.6"
        })
      }),
      env: {
        OPENAI_API_KEY: "openai-key",
        OPENROUTER_API_KEY: "openrouter-key",
        OPENROUTER_HOOK_GENERATION_MODEL: "anthropic/test-hook-model"
      },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://openrouter.ai/api/v1/chat/completions",
      "https://api.openai.com/v1/responses"
    ]);
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Authorization")
    ).toBe("Bearer openrouter-key");
    const generationBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body)
    ) as {
      model: string;
      messages: readonly {
        content: readonly {
          type: string;
          text?: string;
          image_url?: { url: string };
        }[];
      }[];
      response_format: {
        type: string;
        json_schema: { name: string; strict: boolean; schema: unknown };
      };
      provider: { require_parameters: boolean };
    };
    expect(generationBody.model).toBe("anthropic/test-hook-model");
    expect(generationBody.messages[0]?.content[0]?.type).toBe("text");
    expect(generationBody.messages[0]?.content[1]).toEqual({
      type: "image_url",
      image_url: { url: "https://example.com/hero-bottle.png" }
    });
    expect(generationBody.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "moons_hook_generation",
        strict: true
      }
    });
    expect(
      JSON.stringify(generationBody.response_format.json_schema.schema)
    ).not.toContain("maxItems");
    expect(JSON.stringify(generationBody.response_format.json_schema.schema)).toContain(
      "sourceCandidateId"
    );
    expect(generationBody.provider.require_parameters).toBe(true);
  });

  it("surfaces the provider's OpenRouter 400 detail", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 400,
              message: "Unable to download the selected material image."
            }
          }),
          { status: 400 }
        )
      );

    const response = await handleHookGenerationHarnessRequest({
      request: new Request("https://moons.local/api/hook-generation-harness", {
        method: "POST",
        body: JSON.stringify({
          ...requestBody,
          generationModel: "anthropic/claude-sonnet-4.6"
        })
      }),
      env: {
        OPENAI_API_KEY: "openai-key",
        OPENROUTER_API_KEY: "openrouter-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false,
      error:
        "OpenRouter hook harness failed: 400 — Unable to download the selected material image."
    });
  });

  it("retries OpenRouter with inline material data when its provider cannot download an image URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 400,
              message: "Provider returned error",
              metadata: {
                raw: JSON.stringify({
                  type: "error",
                  error: {
                    type: "invalid_request_error",
                    message:
                      "Unable to download the file. Please verify the URL and try again."
                  }
                })
              }
            }
          }),
          { status: 400 }
        )
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { "content-type": "image/png" }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    directions: [
                      {
                        id: "openrouter-hook",
                        sourceCandidateId: "candidate-1",
                        service: "single-static",
                        hook: "มุมคิดใหม่จาก Claude",
                        subheadline: "ยังคงใช้ brief และ brand context ชุดเดิม",
                        concept: "OpenRouter generation",
                        why: "Tests provider routing",
                        visual: "Clean and direct",
                        albumFormat: "three-horizontal",
                        cta: "ดูรายละเอียด",
                        caption: "แคปชั่นจากโมเดลที่เลือก",
                        score: 88,
                        reasoning: "Strong fit",
                        citations: []
                      }
                    ]
                  })
                }
              }
            ]
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(highlightResponse("openrouter-hook", []));

    const response = await handleHookGenerationHarnessRequest({
      request: new Request("https://moons.local/api/hook-generation-harness", {
        method: "POST",
        body: JSON.stringify({
          ...singleStaticRequestBody,
          generationModel: "anthropic/claude-sonnet-4.6"
        })
      }),
      env: {
        OPENAI_API_KEY: "openai-key",
        OPENROUTER_API_KEY: "openrouter-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://example.com/hero-bottle.png"
    );
    const retryBody = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body)
    ) as {
      messages: readonly {
        content: readonly {
          type: string;
          image_url?: { url: string };
        }[];
      }[];
    };
    expect(retryBody.messages[0]?.content[1]?.image_url?.url).toBe(
      "data:image/png;base64,iVBORw=="
    );
  });

  it("passes raw past posts directly into the single creative pass", async () => {
    const writeDebugLog = vi.fn(
      async (_directory: string, _entry: HookGenerationDebugLog) => undefined
    );
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
              directions: [
                {
                  id: "hook-1",
                  sourceCandidateId: "candidate-1",
                  service: "single-static",
                  hook: "ลูกค้า B2B หาเราเจอบน AI หรือยัง?",
                  subheadline: "เปลี่ยน visibility กับยอดขายให้ชัดขึ้น",
                  concept: "เปิดด้วยคำถามที่โยง visibility กับยอดขาย",
                  subheadlineHighlight: "visibility กับยอดขาย",
                  why: "ชัดเจนกับ pain ของธุรกิจที่เริ่มเห็น search เปลี่ยน",
                  visual: "Founder มอง search result + AI answer บนจอ",
                  albumFormat: "three-horizontal",
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
                                    text: "จองด่วน! Workshop AI SEO รอบนี้ที่นั่งจำกัด 🔥\nLINE: @convertcake"
                                  },
                                  {
                                    text: "เริ่มวางแผนการตลาดจากข้อมูลที่วัดผลได้\nLINE: @convertcake"
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
        body: JSON.stringify(singleStaticRequestBody)
      }),
      env: {
        OPENAI_API_KEY: "test-key",
        HOOK_GENERATION_DEBUG_LOG_DIR: "logs/hook-generation",
        SUPABASE_URL: "https://supabase.example.com",
        SUPABASE_ANON_KEY: "anon-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      createPastPostsClient: () => fakePastPostsClient,
      writeDebugLog
    });

    expect(response.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const generationBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body)
    ) as { input: unknown };
    const generationPrompt = JSON.stringify(generationBody.input);
    expect(generationPrompt).toContain(
      "จองด่วน! Workshop AI SEO รอบนี้ที่นั่งจำกัด"
    );
    expect(generationPrompt).toContain(
      "เริ่มวางแผนการตลาดจากข้อมูลที่วัดผลได้"
    );
    expect(generationPrompt).toContain("# Past posts — direct brand evidence");
    expect(generationPrompt).toContain(
      "Past posts ไม่ใช่ตัวอย่างที่ต้องทำตาม"
    );
    expect(generationPrompt).toContain(
      "Hook ต้องเป็น final consumer-facing copy"
    );

    const payload = await response.json();
    expect(payload.directions[0]).toMatchObject({
      hook: "ลูกค้า B2B หาเราเจอบน AI หรือยัง?",
      concept: "เปิดด้วยคำถามที่โยง visibility กับยอดขาย",
      caption: "AI SEO ไม่ใช่เรื่องอนาคตสำหรับ B2B แล้ว"
    });
    const debugEntry = writeDebugLog.mock.calls[0]?.[1];
    expect(debugEntry?.hookAgent.batches[0]?.request.inputText).toContain(
      "จองด่วน! Workshop AI SEO รอบนี้ที่นั่งจำกัด"
    );
    expect(debugEntry).not.toHaveProperty("pastContentAgent");
    expect(debugEntry).not.toHaveProperty("captionAgent");
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
              directions: [
                {
                  id: "hook-2",
                  sourceCandidateId: "candidate-2",
                  service: "single-static",
                  hook: "มุมใหม่ที่ยังไม่เคยพูดถึง",
                  subheadline: "สนับสนุนมุมใหม่โดยไม่ซ้ำเดิม",
                  concept: "Different angle",
                  subheadlineHighlight: "มุมใหม่",
                  why: "Distinct from the previous batch",
                  visual: "Clean, modern.",
                  albumFormat: "three-horizontal",
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
          ...singleStaticRequestBody,
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
      String(fetchMock.mock.calls[0]?.[1]?.body)
    ) as { input: unknown };
    const generationPrompt = JSON.stringify(generationBody.input);
    expect(generationPrompt).toContain("เน้นกลุ่มเจ้าของธุรกิจขนาดเล็กรอบนี้");
    expect(generationPrompt).toContain("ลูกค้า B2B หาเราเจอบน AI หรือยัง?");
    expect(generationPrompt).toContain("DO NOT repeat");
  });
});
