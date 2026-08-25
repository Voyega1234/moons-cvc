import { describe, expect, it, vi } from "vitest";
import {
  buildHookGenerationBatches,
  handleHookGenerationHarnessRequest
} from "./hook-generation-harness-endpoint";
import type { HookGenerationHarnessRequest } from "../../services/creative-generation/harness-hook-generation";
import type { HookGenerationDebugLog } from "./hook-generation-debug-log";

const requestBody = {
  runId: "run-1",
  hookIdeaMode: "fresh-research",
  generationModel: "gpt-5.6-terra" as const,
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

function validHookResearchResponse() {
  return new Response(
    JSON.stringify({
      output_text: JSON.stringify(validHookResearchDossier())
    }),
    { status: 200 }
  );
}

function validHookResearchDossier() {
  return {
    summary: "Use verified brand and audience evidence.",
    references: [],
    insights: [],
    gaps: ["No external claims used by this fixture."]
  };
}

function validHookTopicShortlistResponse() {
  return new Response(
    JSON.stringify({
      output_text: JSON.stringify({
        topics: [
          { topic: "หัวข้อทดสอบ 1", why: "เหตุผลทดสอบ 1" },
          { topic: "หัวข้อทดสอบ 2", why: "เหตุผลทดสอบ 2" }
        ]
      })
    }),
    { status: 200 }
  );
}

function openRouterResearchResponse(
  directions: readonly unknown[],
  citationUrls: readonly string[] = []
) {
  return openRouterJsonResponse({ directions }, citationUrls);
}

function openRouterJsonResponse(
  output: unknown,
  citationUrls: readonly string[] = []
) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            role: "assistant",
            content: `\`\`\`json\n${JSON.stringify(output)}\n\`\`\``,
            annotations: citationUrls.map((url) => ({
                type: "url_citation",
                url_citation: {
                  url,
                  title: "Verified source",
                  content: "Verified product evidence"
                }
              }))
          }
        }
      ],
      usage: {
        server_tool_use_details: { web_search_requests: 1 }
      }
    }),
    { status: 200 }
  );
}

function openRouterHighlightResponse(
  id: string,
  highlights: readonly string[]
) {
  return openRouterJsonResponse({ items: [{ id, highlights }] });
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

function openAiUgcScriptResponse() {
  return new Response(
    JSON.stringify({
      output_text: JSON.stringify({
        format: {
          duration: "30-35 วินาที",
          aspectRatio: "9:16",
          style: "Comedic myth-busting, TikTok energy"
        },
        castDirection: "พนักงาน: energy สูง / ลูกค้า: reaction ชัด",
        beats: [
          {
            id: "beat-1",
            role: "misconception",
            title: "Misconception #1",
            timecode: "0:05-0:09",
            lines: [
              {
                speaker: "customer",
                speakerLabel: "ลูกค้า",
                line: "ต้องเปลี่ยนกระทะทั้งชุดใช่ไหม?",
                direction: null,
                sfx: null
              },
              {
                speaker: "staff",
                speakerLabel: "พนักงาน",
                line: "เลือกใบเดียวก่อนก็ได้!",
                direction: "สวนทันที",
                sfx: "pop"
              }
            ],
            cameraNotes: "Cut กลับพนักงานทันที",
            editingNotes: null,
            legalFlag: null
          }
        ],
        shotList: ["Close-up กระทะ", "Reaction ลูกค้า"],
        editingNotes: ["Cut เร็ว ไม่มี Dead air"],
        legalFooter: null
      })
    }),
    { status: 200 }
  );
}

function openAiStaticDirection() {
  return {
    id: "shared-research-hook",
    sourceCandidateId: "direct-01",
    service: "single-static",
    hook: "AI เปลี่ยนวิธีที่ลูกค้าเจอธุรกิจไปแล้ว",
    subheadline: "เริ่มวางระบบ visibility ก่อนคู่แข่ง",
    concept: "AI visibility gap",
    why: "Connects the category shift to a business consequence.",
    visual: "Search result and AI answer comparison",
    cta: "จองที่นั่ง Webinar",
    supportingPoints: [],
    albumFormat: null,
    formatBeats: [],
    ugcBrief: null,
    ctaActionType: "website",
    ctaDestination: "https://example.com/webinar",
    contactLine: "",
    caption: "เตรียมธุรกิจให้พร้อมกับพฤติกรรมการค้นหาแบบใหม่",
    score: 90,
    reasoning: "Uses the supplied shared dossier.",
    citations: []
  };
}

function openAiStaticDirectionResponse() {
  return new Response(
    JSON.stringify({
      output_text: JSON.stringify({ directions: [openAiStaticDirection()] })
    }),
    { status: 200 }
  );
}

function openAiAlbumDirectionResponse(
  formatBeats: readonly string[],
  albumFormat = "four-grid"
) {
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
            albumFormat,
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

  it("returns one reusable Research dossier without running the Hook Agent", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(validHookResearchResponse());
    const response = await handleHookGenerationHarnessRequest({
      request: new Request("https://moons.local/api/hook-generation-harness", {
        method: "POST",
        body: JSON.stringify({
          ...singleStaticRequestBody,
          researchOnly: true
        })
      }),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      researchDossier: validHookResearchDossier()
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reuses a supplied Research dossier without starting another search", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(validHookTopicShortlistResponse())
      .mockResolvedValueOnce(openAiStaticDirectionResponse())
      .mockResolvedValueOnce(
        highlightResponse("shared-research-hook", ["visibility"])
      );
    const loadHookResearchPrompt = vi.fn(async () => "RESEARCH_PROMPT");
    const response = await handleHookGenerationHarnessRequest({
      request: new Request("https://moons.local/api/hook-generation-harness", {
        method: "POST",
        body: JSON.stringify({
          ...singleStaticRequestBody,
          researchDossier: validHookResearchDossier()
        })
      }),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch,
      loadAgentHookPrompt: async () => "HOOK_PROMPT",
      loadHookResearchPrompt
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(loadHookResearchPrompt).not.toHaveBeenCalled();
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
              summary: "ธุรกิจไทยเริ่มให้ความสำคัญกับ AI visibility",
              references: [],
              insights: [],
              gaps: ["No strong public source was found."]
            })
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(validHookTopicShortlistResponse())
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
                  albumFormat: null,
                  cta: "จองที่นั่ง Webinar",
                  caption: "AI SEO ไม่ใช่เรื่องอนาคตสำหรับ B2B แล้ว",
                  score: 91,
                  reasoning: "Brand truth, ownership, parity และเหตุผลผลิตครบ",
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
      loadSubheadlineHighlightPrompt: async () =>
        "HIGHLIGHT_PROMPT_SOURCE_ONLY",
      writeDebugLog
    });

    const responseBody = await response.clone().json();
    expect(response.status, JSON.stringify(responseBody)).toBe(200);
    expect(responseBody.directions[0]).not.toHaveProperty("albumFormat");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const researchBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body)
    ) as {
      tools?: unknown[];
      tool_choice?: string;
      reasoning?: { effort?: string };
      input: unknown;
      text: { format: { name: string } };
    };
    expect(researchBody.tools).toEqual([
      expect.objectContaining({ type: "web_search_preview" })
    ]);
    expect(researchBody.tool_choice).toBe("required");
    expect(researchBody.reasoning).toEqual({ effort: "medium" });
    expect(researchBody.text.format.name).toBe("moons_hook_research");

    const generationBody = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body)
    ) as {
      tools?: unknown[];
      reasoning?: { effort?: string };
      input: unknown;
      text: {
        format: {
          name: string;
          schema: {
            properties: {
              directions: {
                items: {
                  properties: Record<string, unknown>;
                  required: string[];
                };
              };
            };
          };
        };
      };
    };
    expect(generationBody.tools).toBeUndefined();
    expect(generationBody.reasoning).toEqual({ effort: "high" });
    expect(generationBody.text.format.name).toBe("moons_hook_generation");
    const directionSchema =
      generationBody.text.format.schema.properties.directions.items;
    expect(directionSchema.required).toEqual(
      Object.keys(directionSchema.properties)
    );
    const prompt = JSON.stringify(generationBody.input);
    expect(prompt).toContain("AGENT_HOOK_SEARCH_POLICY_ONLY");
    expect(prompt).toContain(
      "Research status: completed by the dedicated Research Agent"
    );
    expect(prompt).toContain("# Required output mix");
    expect(prompt).toContain("# Format");
    expect(prompt).toContain("scriptLines คือคำพูดจริง");
    expect(JSON.stringify(directionSchema.properties)).toContain("scriptLines");
    expect(JSON.stringify(directionSchema.properties)).toContain("textOverlay");

    const supportBody = JSON.parse(
      String(fetchMock.mock.calls[3]?.[1]?.body)
    ) as { reasoning?: unknown; input?: unknown };
    expect(supportBody.reasoning).toBeUndefined();
    expect(JSON.stringify(supportBody.input)).toContain(
      "HIGHLIGHT_PROMPT_SOURCE_ONLY"
    );

    const debugEntry = writeDebugLog.mock.calls[0]?.[1];
    expect(debugEntry?.researchAgent.request.tools).toEqual([
      expect.objectContaining({ type: "web_search_preview" })
    ]);
    expect(debugEntry?.hookAgent.batches[0]?.request.tools).toEqual([]);
    expect(debugEntry?.finalResponse).toMatchObject({
      directions: [expect.objectContaining({ id: "hook-1" })]
    });
  });

  it("does not apply hidden semantic quality rules after structured output", async () => {
    const direction = {
      id: "weak-hook",
      sourceCandidateId: "direct-01",
      service: "single-static",
      hook: "ไอเดียที่ยังไม่ผ่าน",
      subheadline: "Draft แรกใช้คะแนนผิดสเกล",
      concept: "Weak draft",
      why: "Needs an editorial pass",
      visual: "Simple visual",
      cta: "ดูรายละเอียด",
      albumFormat: "three-horizontal",
      supportingPoints: ["กลิ่นไม่ฉุน ไม่ทำให้ปวดหัว"],
      caption: "Draft ที่ยังไม่พร้อมใช้",
      score: 9.4,
      reasoning: "Scored on a ten-point scale",
      citations: []
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(validHookResearchResponse())
      .mockResolvedValueOnce(validHookTopicShortlistResponse())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({ directions: [direction] })
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(highlightResponse("weak-hook", []));

    const response = await handleHookGenerationHarnessRequest({
      request: new Request("https://moons.local/api/hook-generation-harness", {
        method: "POST",
        body: JSON.stringify(singleStaticRequestBody)
      }),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(await response.json()).toMatchObject({
      directions: [
        expect.objectContaining({
          hook: "ไอเดียที่ยังไม่ผ่าน",
          supportingPoints: ["กลิ่นไม่ฉุน ไม่ทำให้ปวดหัว"],
          score: 9.4
        })
      ]
    });
  });

  it("defaults requests without a Hook idea mode to required Thailand research", async () => {
    const bodyWithoutMode = {
      ...requestBody,
      quantity: 1,
      contentTypeQuotas: [{ service: "single-static", count: 1 }]
    } as Record<string, unknown>;
    delete bodyWithoutMode.hookIdeaMode;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(validHookResearchResponse())
      .mockResolvedValueOnce(validHookTopicShortlistResponse())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              directions: [
                {
                  id: "hook-fresh-research",
                  service: "single-static",
                  hook: "เริ่มจากปัญหาที่ลูกค้าเจอจริงในวันนี้",
                  subheadline: "ใช้ Search เพื่อเติมบริบทที่ตรวจสอบได้",
                  concept: "Fresh researched brand-led idea",
                  why: "Uses supplied context and current research",
                  visual: "Clean and direct",
                  albumFormat: "three-horizontal",
                  formatBeats: [],
                  cta: "ดูรายละเอียด",
                  caption: "เริ่มจากข้อมูลแบรนด์และบริบทปัจจุบัน",
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
      .mockResolvedValueOnce(highlightResponse("hook-fresh-research", []));

    const response = await handleHookGenerationHarnessRequest({
      request: new Request("https://moons.local/api/hook-generation-harness", {
        method: "POST",
        body: JSON.stringify(bodyWithoutMode)
      }),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch,
      loadAgentHookPrompt: async () =>
        "# AGENT HOOK\nSEARCH_POLICY_FROM_AGENT_HOOK"
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const researchBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body)
    ) as {
      tools?: unknown[];
      tool_choice?: string;
      input: unknown;
      text: { format: { name: string } };
    };
    expect(researchBody.tools).toEqual([
      expect.objectContaining({ type: "web_search_preview" })
    ]);
    expect(researchBody.tool_choice).toBe("required");
    expect(researchBody.text.format.name).toBe("moons_hook_research");
    const generationBody = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body)
    ) as { tools?: unknown[]; input: unknown; text: { format: { name: string } } };
    expect(generationBody.tools).toBeUndefined();
    expect(generationBody.text.format.name).toBe("moons_hook_generation");
    const generationPrompt = JSON.stringify(generationBody.input);
    expect(generationPrompt).toContain("SEARCH_POLICY_FROM_AGENT_HOOK");
    expect(generationPrompt).toContain("Research status: completed");
    expect(generationPrompt).toContain("# Runtime contract");
  });

  it("migrates a hidden legacy standard mode to required Thailand research", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(validHookResearchResponse())
      .mockResolvedValueOnce(validHookTopicShortlistResponse())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              directions: [
                {
                  id: "hook-migrated-research",
                  service: "single-static",
                  hook: "เริ่มจากสิ่งที่ผู้ชมสนใจจริง",
                  subheadline: null,
                  concept: "Legacy mode migrated to researched generation",
                  why: "The UI no longer exposes a no-research choice",
                  visual: "Clean and direct",
                  albumFormat: "three-horizontal",
                  formatBeats: [],
                  cta: "ดูรายละเอียด",
                  caption: "ใช้ข้อมูลแบรนด์ร่วมกับบริบทที่ค้นเพิ่ม",
                  score: 85,
                  reasoning: "Research is required",
                  citations: []
                }
              ]
            })
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(highlightResponse("hook-migrated-research", []));

    const response = await handleHookGenerationHarnessRequest({
      request: new Request("https://moons.local/api/hook-generation-harness", {
        method: "POST",
        body: JSON.stringify({
          ...requestBody,
          hookIdeaMode: "standard",
          quantity: 1,
          contentTypeQuotas: [{ service: "single-static", count: 1 }]
        })
      }),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch,
      loadAgentHookPrompt: async () => "# AGENT HOOK"
    });

    expect(response.status).toBe(200);
    const responseBody = (await response.clone().json()) as {
      directions: Array<{ subheadline: string }>;
    };
    expect(responseBody.directions[0]?.subheadline).toBe("");
    const generationBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body)
    ) as { tools?: unknown[]; tool_choice?: string; input: unknown };
    expect(generationBody.tools).toEqual([
      expect.objectContaining({ type: "web_search_preview" })
    ]);
    expect(generationBody.tool_choice).toBe("required");
    const hookBody = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body)
    ) as {
      tools?: unknown[];
      input: unknown;
      text: {
        format: {
          schema: {
            properties: {
              directions: {
                items: { properties: { subheadline: { type: string[] } } };
              };
            };
          };
        };
      };
    };
    expect(hookBody.tools).toBeUndefined();
    expect(JSON.stringify(hookBody.input)).toContain("Research status: completed");
    expect(
      hookBody.text.format.schema.properties.directions.items.properties
        .subheadline.type
    ).toEqual(["string", "null"]);
  });

  it("rewrites a final Thai direction when its copy uses ฉัน", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(validHookResearchResponse())
      .mockResolvedValueOnce(validHookTopicShortlistResponse())
      .mockResolvedValueOnce(openAiUgcDirectionResponse("ฉันเลือกจากการใช้งานจริง"))
      .mockResolvedValueOnce(openAiUgcDirectionResponse("เลือกจากการใช้งานจริง"))
      .mockResolvedValueOnce(highlightResponse("ugc-natural-thai", []))
      .mockResolvedValueOnce(openAiUgcScriptResponse());

    const response = await handleHookGenerationHarnessRequest({
      request: new Request("https://moons.local/api/hook-generation-harness", {
        method: "POST",
        body: JSON.stringify(singleUgcRequestBody)
      }),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    const responseBody = await response.clone().json();
    expect(response.status, JSON.stringify(responseBody)).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    const directionRetryBody = JSON.parse(
      String(fetchMock.mock.calls[3]?.[1]?.body)
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
    const ugcScriptRequestBody = JSON.parse(
      String(fetchMock.mock.calls[5]?.[1]?.body)
    ) as { input: unknown };
    expect(JSON.stringify(ugcScriptRequestBody.input)).toContain(
      "UGC MYTH-BUSTING SCRIPT WRITER"
    );
    expect(
      (body as { directions: { ugcScript?: { beats: unknown[] } }[] })
        .directions[0]?.ugcScript?.beats
    ).toHaveLength(1);
  });

  it("degrades gracefully when the UGC script agent call fails, keeping the slide-ready ugcBrief", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(validHookResearchResponse())
      .mockResolvedValueOnce(validHookTopicShortlistResponse())
      .mockResolvedValueOnce(openAiUgcDirectionResponse("เลือกจากการใช้งานจริง"))
      .mockResolvedValueOnce(highlightResponse("ugc-natural-thai", []))
      .mockResolvedValueOnce(new Response("Server error", { status: 500 }))
      .mockResolvedValueOnce(new Response("Server error", { status: 500 }));

    const response = await handleHookGenerationHarnessRequest({
      request: new Request("https://moons.local/api/hook-generation-harness", {
        method: "POST",
        body: JSON.stringify(singleUgcRequestBody)
      }),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    const body = (await response.json()) as {
      directions: { ugcBrief?: unknown; ugcScript?: unknown }[];
    };
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.directions[0]?.ugcBrief).toBeTruthy();
    expect(body.directions[0]?.ugcScript).toBeUndefined();
  });

  it("retries album output when formatBeats does not match the selected layout", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(validHookResearchResponse())
      .mockResolvedValueOnce(validHookTopicShortlistResponse())
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
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const retryBody = JSON.parse(
      String(fetchMock.mock.calls[3]?.[1]?.body)
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

  it("accepts two formatBeats for a three-panel album layout", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(validHookResearchResponse())
      .mockResolvedValueOnce(validHookTopicShortlistResponse())
      .mockResolvedValueOnce(
        openAiAlbumDirectionResponse(
          ["Panel 2", "Panel 3"],
          "three-horizontal"
        )
      )
      .mockResolvedValueOnce(highlightResponse("album-panel-count", []));

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
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const payload = (await response.json()) as {
      directions: { albumFormat: string; formatBeats: string[] }[];
    };
    expect(payload.directions[0]).toMatchObject({
      albumFormat: "three-horizontal",
      formatBeats: ["Panel 2", "Panel 3"]
    });
  });

  it("defaults the direct creative pass to OpenRouter when no model is selected", async () => {
    const {
      generationModel: _generationModel,
      ...requestWithoutGenerationModel
    } = singleStaticRequestBody;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(validHookResearchResponse())
      .mockResolvedValueOnce(validHookTopicShortlistResponse())
      .mockResolvedValueOnce(
        openRouterResearchResponse([
          {
            id: "openrouter-hook",
            sourceCandidateId: "candidate-1",
            service: "single-static",
            hook: "มุมคิดใหม่จาก OpenRouter",
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
        ])
      )
      .mockResolvedValueOnce(openRouterHighlightResponse("openrouter-hook", []));

    const response = await handleHookGenerationHarnessRequest({
      request: new Request("https://moons.local/api/hook-generation-harness", {
        method: "POST",
        body: JSON.stringify(requestWithoutGenerationModel)
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
      "https://api.openai.com/v1/responses",
      "https://api.openai.com/v1/responses",
      "https://openrouter.ai/api/v1/chat/completions",
      "https://openrouter.ai/api/v1/chat/completions"
    ]);
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Authorization")
    ).toBe("Bearer openai-key");
    const generationBody = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body)
    ) as {
      model: string;
      messages: readonly {
        content: readonly {
          type: string;
          text?: string;
        }[];
      }[];
      response_format: {
        type: string;
        json_schema: { name: string; strict: boolean; schema: unknown };
      };
      plugins?: readonly Record<string, unknown>[];
      provider?: { require_parameters?: boolean };
    };
    expect(generationBody.model).toBe("google/gemini-3.6-flash");
    expect(generationBody.messages[0]?.content[0]?.type).toBe("text");
    expect(generationBody.messages[0]?.content).toHaveLength(1);
    expect(generationBody.response_format).toMatchObject({
      type: "json_schema"
    });
    expect(generationBody.response_format.json_schema).toMatchObject({
      name: "moons_hook_generation",
      strict: true
    });
    expect(
      JSON.stringify(generationBody.response_format.json_schema.schema)
    ).not.toContain("maxItems");
    expect(
      JSON.stringify(generationBody.response_format.json_schema.schema)
    ).toContain("sourceCandidateId");
    const openRouterSchema = JSON.stringify(
      generationBody.response_format.json_schema.schema
    );
    expect(openRouterSchema).not.toContain('"type":["string","null"]');
    expect(openRouterSchema).not.toContain('"type":["object","null"]');
    expect(openRouterSchema).toContain('"anyOf"');
    expect(openRouterSchema).toContain('"scriptLines"');
    expect(openRouterSchema).toContain('"textOverlay"');
    const directionSchema = generationBody.response_format.json_schema.schema as {
      properties: {
        directions: {
          items: {
            properties: Record<string, unknown>;
            required: string[];
          };
        };
      };
    };
    expect(directionSchema.properties.directions.items.required).toEqual(
      Object.keys(directionSchema.properties.directions.items.properties)
    );
    expect(generationBody.plugins).toBeUndefined();
    expect(generationBody.provider).toEqual({ require_parameters: true });
    const highlightBody = JSON.parse(
      String(fetchMock.mock.calls[3]?.[1]?.body)
    ) as {
      response_format: {
        json_schema: { schema: unknown };
      };
    };
    expect(
      JSON.stringify(highlightBody.response_format.json_schema.schema)
    ).not.toContain("maxItems");
    const researchBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body)
    ) as { model: string; tools?: unknown[]; tool_choice?: string };
    expect(researchBody.model).toBe("gpt-5.6-terra");
    expect(researchBody.tools).toEqual([
      expect.objectContaining({ type: "web_search_preview" })
    ]);
    expect(researchBody.tool_choice).toBe("required");
    const payload = (await response.json()) as {
      directions: { id: string; sourceCandidateId: string }[];
    };
    expect(payload.directions[0]).toMatchObject({
      id: "openrouter-hook",
      sourceCandidateId: "candidate-1"
    });
  });

  it("surfaces the provider's OpenRouter 400 detail", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(validHookResearchResponse())
      .mockResolvedValueOnce(validHookTopicShortlistResponse())
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
          hookIdeaMode: "standard",
          generationModel: "google/gemini-3.6-flash"
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
    const openRouterBody = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body)
    ) as { plugins?: unknown; tools?: unknown; tool_choice?: unknown };
    expect(openRouterBody.plugins).toBeUndefined();
    expect(openRouterBody.tools).toBeUndefined();
    expect(openRouterBody.tool_choice).toBeUndefined();
  });

  it("sends questionnaire, full brand library, brand memory, brief, and research context but not past posts or attachments", async () => {
    const writeDebugLog = vi.fn(
      async (_directory: string, _entry: HookGenerationDebugLog) => undefined
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(validHookResearchResponse())
      .mockResolvedValueOnce(validHookTopicShortlistResponse())
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

    const response = await handleHookGenerationHarnessRequest({
      request: new Request("https://moons.local/api/hook-generation-harness", {
        method: "POST",
        body: JSON.stringify(singleStaticRequestBody)
      }),
      env: {
        OPENAI_API_KEY: "test-key",
        HOOK_GENERATION_DEBUG_LOG_DIR: "logs/hook-generation"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      writeDebugLog
    });

    expect(response.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const generationBody = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body)
    ) as { input: unknown };
    const generationPrompt = JSON.stringify(generationBody.input);
    expect(generationPrompt).toContain("# Questionnaire");
    expect(generationPrompt).toContain("ข้อมูลตอน Onboarding");
    expect(generationPrompt).toContain("# Brand name");
    expect(generationPrompt).toContain("Convert Cake");
    expect(generationPrompt).toContain("# Brand system");
    expect(generationPrompt).toContain("Positioning");
    expect(generationPrompt).toContain("# Brand products");
    expect(generationPrompt).toContain("AI SEO Strategy Workshop");
    expect(generationPrompt).toContain("# Brand docs");
    expect(generationPrompt).toContain("Brand guideline");
    expect(generationPrompt).toContain("# Brand references");
    expect(generationPrompt).toContain("Screenshot 2026-08-03.png");
    expect(generationPrompt).toContain("# Brand memory");
    expect(generationPrompt).toContain("ใช้ภาษาไทยตรง ชัด และโยงกับยอดขายได้");
    expect(generationPrompt).toContain("หลีกเลี่ยงภาพ luxury หรือ warm vintage");
    expect(generationPrompt).toContain("# User brief");
    expect(generationPrompt).toContain("ต้องการ creative เพื่อชวน B2B");
    expect(generationPrompt).toContain("# Dedicated Research Agent dossier");
    expect(generationPrompt).toContain("# Topic Agent shortlist");
    expect(generationPrompt).not.toContain("# Past posts");
    expect(generationPrompt).not.toContain("# Past content data");
    expect(generationPrompt).not.toContain("launch-questionnaire.pdf");
    expect(generationPrompt).not.toContain("hero-bottle.png");
    const debugEntry = writeDebugLog.mock.calls[0]?.[1];
    expect(debugEntry).not.toHaveProperty("pastContentAgent");
    expect(debugEntry).not.toHaveProperty("captionAgent");
  });

  it("adds past posts to Hook generation as caption-style evidence but keeps them out of Research", async () => {
    const loadPastPostExamples = vi.fn(async () => [
      {
        source: "ad_caption" as const,
        text: "เริ่มด้วยปัญหาแบบตรง ๆ\n\nแล้วค่อยขยายเหตุผล\n\nทักมาคุยกัน"
      },
      {
        source: "organic_post" as const,
        text: "เบื้องหลังงานวันนี้ ✨\n\nเล่าสั้นเป็นย่อหน้า"
      }
    ]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(validHookResearchResponse())
      .mockResolvedValueOnce(validHookTopicShortlistResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output_text: JSON.stringify({
          directions: [
            {
              ...openAiStaticDirection(),
              id: "past-style-hook",
              sourceCandidateId: "direct-01"
            }
          ]
        })
      }), { status: 200 }))
      .mockResolvedValueOnce(
        highlightResponse("past-style-hook", ["พฤติกรรมการค้นหา"])
      );

    const response = await handleHookGenerationHarnessRequest({
      request: new Request("https://moons.local/api/hook-generation-harness", {
        method: "POST",
        body: JSON.stringify(singleStaticRequestBody)
      }),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch,
      loadPastPostExamples
    });

    expect(response.status).toBe(200);
    expect(loadPastPostExamples).toHaveBeenCalledWith({
      clientId: "convert-cake",
      env: { OPENAI_API_KEY: "test-key" },
      accessToken: null
    });

    const researchPrompt = JSON.stringify(
      (JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { input: unknown }).input
    );
    const generationPrompt = JSON.stringify(
      (JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)) as { input: unknown }).input
    );
    expect(researchPrompt).not.toContain("เริ่มด้วยปัญหาแบบตรง ๆ");
    expect(generationPrompt).toContain(
      "# Past posts — caption style evidence only"
    );
    expect(generationPrompt).toContain("เริ่มด้วยปัญหาแบบตรง ๆ");
    expect(generationPrompt).toContain("เบื้องหลังงานวันนี้");
    expect(generationPrompt).toContain("hashtag fingerprint");
    expect(generationPrompt).toContain(
      "whether they appear inline or as a final block"
    );
    expect(generationPrompt).toContain("contact/footer → hashtags");
    expect(generationPrompt).toContain(
      "Do not copy an old phrase, idea, offer, claim, hashtag, contact detail"
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

  it("passes extra instructions but ignores legacy existing hook history", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(validHookResearchResponse())
      .mockResolvedValueOnce(validHookTopicShortlistResponse())
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
      String(fetchMock.mock.calls[2]?.[1]?.body)
    ) as { input: unknown };
    const generationPrompt = JSON.stringify(generationBody.input);
    expect(generationPrompt).toContain("เน้นกลุ่มเจ้าของธุรกิจขนาดเล็กรอบนี้");
    expect(generationPrompt).not.toContain("ลูกค้า B2B หาเราเจอบน AI หรือยัง?");
    expect(generationPrompt).not.toContain("DO NOT repeat");
  });
});
