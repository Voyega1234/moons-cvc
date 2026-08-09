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

function validHookResearchResponse() {
  return new Response(
    JSON.stringify({
      output_text: JSON.stringify({
        brand: "Convert Cake",
        productFocus: "AI SEO webinar",
        overallFinding: "Use verified brand and audience evidence.",
        references: [],
        strongestReferenceIds: [],
        researchGaps: [],
        researchLimitations: "No external claims used by this fixture.",
        excluded: [],
        searchQueriesUsed: ["AI SEO Thailand"]
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

function openRouterHookResearchDossierResponse() {
  return openRouterJsonResponse({
    brand: "Convert Cake",
    productFocus: "AI SEO webinar",
    overallFinding: "Use verified brand and audience evidence.",
    references: [],
    strongestReferenceIds: [],
    researchGaps: [],
    researchLimitations: "No external claims used by this fixture.",
    excluded: [],
    searchQueriesUsed: ["AI SEO Thailand"]
  });
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
              brand: "Convert Cake",
              productFocus: "AI SEO webinar",
              overallFinding: "ธุรกิจไทยเริ่มให้ความสำคัญกับ AI visibility",
              references: [],
              strongestReferenceIds: [],
              researchGaps: [],
              researchLimitations: "No strong public source was found.",
              excluded: [],
              searchQueriesUsed: ["AI SEO Thailand B2B"]
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
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
    expect(researchBody.reasoning).toEqual({ effort: "high" });
    expect(researchBody.text.format.name).toBe("moons_hook_research");

    const generationBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body)
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

    const supportBody = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body)
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
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
      String(fetchMock.mock.calls[1]?.[1]?.body)
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
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              directions: [
                {
                  id: "hook-migrated-research",
                  service: "single-static",
                  hook: "เริ่มจากสิ่งที่ผู้ชมสนใจจริง",
                  subheadline: "",
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
    const generationBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body)
    ) as { tools?: unknown[]; tool_choice?: string; input: unknown };
    expect(generationBody.tools).toEqual([
      expect.objectContaining({ type: "web_search_preview" })
    ]);
    expect(generationBody.tool_choice).toBe("required");
    const hookBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body)
    ) as { tools?: unknown[]; input: unknown };
    expect(hookBody.tools).toBeUndefined();
    expect(JSON.stringify(hookBody.input)).toContain("Research status: completed");
  });

  it("rewrites a final Thai direction when its copy uses ฉัน", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(validHookResearchResponse())
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

    const responseBody = await response.clone().json();
    expect(response.status, JSON.stringify(responseBody)).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const directionRetryBody = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body)
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

  it("retries album output when formatBeats does not match the selected layout", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(validHookResearchResponse())
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
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const retryBody = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body)
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
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const payload = (await response.json()) as {
      directions: { albumFormat: string; formatBeats: string[] }[];
    };
    expect(payload.directions[0]).toMatchObject({
      albumFormat: "three-horizontal",
      formatBeats: ["Panel 2", "Panel 3"]
    });
  });

  it("routes the direct creative pass through OpenRouter when selected", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(openRouterHookResearchDossierResponse())
      .mockResolvedValueOnce(
        openRouterResearchResponse([
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
        ])
      )
      .mockResolvedValueOnce(openRouterHighlightResponse("openrouter-hook", []));

    const response = await handleHookGenerationHarnessRequest({
      request: new Request("https://moons.local/api/hook-generation-harness", {
        method: "POST",
        body: JSON.stringify({
          ...singleStaticRequestBody,
          generationModel: "google/gemini-3.6-flash"
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
      "https://openrouter.ai/api/v1/chat/completions",
      "https://openrouter.ai/api/v1/chat/completions"
    ]);
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Authorization")
    ).toBe("Bearer openrouter-key");
    const generationBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body)
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
      plugins?: readonly Record<string, unknown>[];
      provider?: { require_parameters?: boolean };
    };
    expect(generationBody.model).toBe("anthropic/test-hook-model");
    expect(generationBody.messages[0]?.content[0]?.type).toBe("text");
    expect(generationBody.messages[0]?.content[1]).toEqual({
      type: "image_url",
      image_url: { url: "https://example.com/hero-bottle.png" }
    });
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
    const researchBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body)
    ) as { plugins?: unknown };
    expect(researchBody.plugins).toEqual([
      { id: "web", engine: "native", max_results: 5 }
    ]);
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
      .mockResolvedValueOnce(openRouterHookResearchDossierResponse())
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
      String(fetchMock.mock.calls[0]?.[1]?.body)
    ) as { plugins?: unknown; tools?: unknown; tool_choice?: unknown };
    expect(openRouterBody.plugins).toEqual([
      { id: "web", engine: "native", max_results: 5 }
    ]);
    expect(openRouterBody.tools).toBeUndefined();
    expect(openRouterBody.tool_choice).toBeUndefined();
  });

  it("retries OpenRouter with inline material data when its provider cannot download an image URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(openRouterHookResearchDossierResponse())
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
        openRouterResearchResponse([
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
        ])
      )
      .mockResolvedValueOnce(openRouterHighlightResponse("openrouter-hook", []));

    const response = await handleHookGenerationHarnessRequest({
      request: new Request("https://moons.local/api/hook-generation-harness", {
        method: "POST",
        body: JSON.stringify({
          ...singleStaticRequestBody,
          generationModel: "google/gemini-3.6-flash"
        })
      }),
      env: {
        OPENAI_API_KEY: "openai-key",
        OPENROUTER_API_KEY: "openrouter-key"
      },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe(
      "https://example.com/hero-bottle.png"
    );
    const retryBody = JSON.parse(
      String(fetchMock.mock.calls[3]?.[1]?.body)
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
      .mockResolvedValueOnce(validHookResearchResponse())
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

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const generationBody = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body)
    ) as { input: unknown };
    const generationPrompt = JSON.stringify(generationBody.input);
    expect(JSON.stringify(generationBody.input)).toContain(
      "จองด่วน! Workshop AI SEO รอบนี้ที่นั่งจำกัด"
    );
    expect(JSON.stringify(generationBody.input)).toContain(
      "เรียนรู้ Style Fingerprint จากหลายโพสต์ร่วมกัน"
    );
    expect(generationPrompt).toContain("# Past content data");
    expect(generationPrompt).toContain(
      "Paid Ad เรียนรู้จากแคปชั่นโฆษณา"
    );
    expect(generationPrompt).toContain(
      "Opening ของ Caption ต้องต่อยอด Direction ใหม่"
    );
    const debugEntry = writeDebugLog.mock.calls[0]?.[1];
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
      .mockResolvedValueOnce(validHookResearchResponse())
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
      String(fetchMock.mock.calls[1]?.[1]?.body)
    ) as { input: unknown };
    const generationPrompt = JSON.stringify(generationBody.input);
    expect(generationPrompt).toContain("เน้นกลุ่มเจ้าของธุรกิจขนาดเล็กรอบนี้");
    expect(generationPrompt).toContain("ลูกค้า B2B หาเราเจอบน AI หรือยัง?");
    expect(generationPrompt).toContain("DO NOT repeat");
  });
});
