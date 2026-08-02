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

function candidateJson(id: string) {
  const services = [
    ...Array.from({ length: 9 }, () => "single-static" as const),
    ...Array.from({ length: 4 }, () => "album-post" as const),
    ...Array.from({ length: 6 }, () => "ugc-video" as const)
  ];
  return {
    candidates: services.map((service, index) => ({
      id: index === 0 ? id : `${id}-${index + 1}`,
      service,
      hook: `ลูกค้า B2B หาเราเจอบน AI หรือยัง? ${index + 1}`,
      premise: `ตั้งคำถามเรื่องการถูกค้นพบใน AI แบบ ${index + 1}`,
      primaryBenefit: `ประโยชน์หลัก ${index + 1}`,
      creativePattern: `creative pattern ${index + 1}`,
      languageDevice: `language device ${index + 1}`,
      audienceReason: "เจ้าของธุรกิจเริ่มเห็นพฤติกรรม Search เปลี่ยน",
      formatIdea: `ไอเดียสำหรับ ${service}`,
      citations: ["AI search behavior"]
    }))
  };
}

function openAiCandidateResponse(id = "candidate-1") {
  return new Response(
    JSON.stringify({ output_text: JSON.stringify(candidateJson(id)) }),
    { status: 200 }
  );
}

function openAiCandidateResponseWithForbiddenUgc() {
  const value = candidateJson("candidate-1");
  const ugcCandidate = value.candidates[13];
  if (ugcCandidate) ugcCandidate.hook = "ฉันเลือกกระทะใบนี้";
  return new Response(
    JSON.stringify({ output_text: JSON.stringify(value) }),
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
            formatBeats: ["เปิดด้วยเกณฑ์เลือก", "สาธิตสินค้า", "ปิดด้วย CTA"],
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

function openRouterCandidateResponse(id = "candidate-1") {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(candidateJson(id)) } }]
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

  it("lets the Hook Agent search before generating ranked directions", async () => {
    const writeDebugLog = vi.fn(
      async (_directory: string, _entry: HookGenerationDebugLog) => undefined
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(openAiCandidateResponse())
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
        OPENAI_HOOK_GENERATION_MODEL: "gpt-test",
        HOOK_GENERATION_DEBUG_LOG_DIR: "logs/hook-generation"
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      writeDebugLog
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
    ) as {
      tools?: unknown[];
      tool_choice?: string;
      model: string;
      input: unknown;
    };
    const directorBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body)
    ) as { model: string; input: unknown; tools?: unknown[] };
    const thirdBody = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body)
    ) as {
      model: string;
      input: { content: { text: string }[] }[];
      text: { format: { name: string } };
    };

    expect(firstBody.model).toBe("gpt-test");
    expect(firstBody.tools).toEqual([
      {
        type: "web_search_preview",
        user_location: {
          type: "approximate",
          country: "TH",
          timezone: "Asia/Bangkok"
        }
      }
    ]);
    expect(firstBody.tool_choice).toBe("required");
    expect(directorBody.model).toBe("gpt-test");
    expect(directorBody.tools).toBeUndefined();
    expect(thirdBody.model).toBe("gpt-5.6-luna");
    const generationPrompt = JSON.stringify(firstBody.input);
    const directorPrompt = JSON.stringify(directorBody.input);
    const combinedCreativePrompts = `${generationPrompt}\n${directorPrompt}`;
    expect(generationPrompt).toContain("# CREATIVE STRATEGIST");
    expect(generationPrompt).toContain("# Search — required");
    expect(JSON.stringify(firstBody.input)).toContain(
      "FRESH RESEARCH MODE"
    );
    expect(JSON.stringify(firstBody.input)).toContain(
      "ค้นหลาย query ภาษาไทย"
    );
    expect(JSON.stringify(firstBody.input)).toContain("THAILAND FIRST");
    expect(generationPrompt).toContain("# Divergent ideation");
    expect(generationPrompt).toContain(
      "กระจาย content archetype"
    );
    expect(generationPrompt).toContain("ภาษาไทยห้ามใช้คำว่า ‘ฉัน’");
    expect(generationPrompt).toContain(
      "social proof, brand belief, humor หรือ wordplay"
    );
    expect(directorPrompt).toContain(
      "เปรียบเทียบแบบ relative ทั้งชุด"
    );
    expect(directorPrompt).toContain("ภาษาไทยห้ามใช้คำว่า ‘ฉัน’");
    expect(JSON.stringify(firstBody.input)).toContain(
      "ต้องเรียก Web Search ก่อน final JSON ทุก batch"
    );
    expect(combinedCreativePrompts).toContain(
      "อ่านออกเสียงและตรวจคำปฏิเสธ"
    );
    expect(combinedCreativePrompts).toContain(
      "ไม่ให้ความหมายกลับด้าน"
    );
    expect(JSON.stringify(firstBody.input)).toContain(
      "ต้องการ creative เพื่อชวน B2B"
    );
    expect(JSON.stringify(firstBody.input)).toContain(
      "ข้อมูลตอน Onboarding: ลูกค้าหลักเป็นเจ้าของธุรกิจ B2B"
    );
    expect(JSON.stringify(firstBody.input)).toContain(
      "NOT A CURRENT CAMPAIGN BRIEF"
    );
    expect(combinedCreativePrompts).toContain(
      "# Format"
    );
    expect(directorPrompt).toContain(
      "เลือกและขยาย 6 directions ตาม quota นี้และตามลำดับ"
    );
    expect(combinedCreativePrompts).toContain("ALBUM AD");
    expect(combinedCreativePrompts).toContain("UGC VIDEO");
    expect(directorPrompt).toContain(
      "caption และ cta ห้ามมีคำลงท้าย"
    );
    expect(combinedCreativePrompts).not.toContain(
      "subheadlineHighlight"
    );
    expect(directorPrompt).toContain(
      "subheadline เป็นหนึ่งประโยคสั้น"
    );
    expect(directorPrompt).toContain(
      "album-post: คิดเป็น swipeable story"
    );
    expect(combinedCreativePrompts).toContain(
      "Album layout preference: auto"
    );
    expect(directorPrompt).toContain(
      "เลือก albumFormat ให้เหมาะกับแนวคิด"
    );
    expect(directorPrompt).toContain(
      "3 supporting topics"
    );
    expect(directorPrompt).toContain(
      "ugc-video: creator-led vertical video"
    );
    expect(directorPrompt).toContain(
      "scripts ช่วง opening/showcase/closing"
    );
    expect(directorPrompt).toContain("ugcBrief");
    expect(directorPrompt).toContain(
      "single-static: หนึ่งความคิดที่จบในภาพเดียว"
    );
    expect(directorPrompt).toContain("formatBeats");
    expect(JSON.stringify(firstBody.input)).toContain(
      "hero-bottle.png | role=main-object"
    );
    expect(JSON.stringify(firstBody.input)).toContain(
      '"type":"input_image"'
    );
    expect(JSON.stringify(firstBody.input)).toContain(
      "https://example.com/hero-bottle.png"
    );
    expect(JSON.stringify(firstBody.input)).not.toContain("$('Webhook')");
    expect(generationPrompt.length).toBeLessThan(24_000);
    expect(directorPrompt).toContain(
      "# CREATIVE DIRECTOR — SELECT, SHARPEN, EXPAND"
    );
    expect(directorPrompt).toContain("Candidate pool");
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

    expect(writeDebugLog).toHaveBeenCalledTimes(1);
    const [debugDirectory, debugEntry] = writeDebugLog.mock.calls[0] ?? [];
    expect(debugDirectory).toBe("logs/hook-generation");
    expect(debugEntry?.candidateAgent.batches[0]?.request.inputText).toContain(
      "# Search — required"
    );
    expect(debugEntry?.candidateAgent.batches[0]?.request.tools).toEqual([
      {
        type: "web_search_preview",
        user_location: {
          type: "approximate",
          country: "TH",
          timezone: "Asia/Bangkok"
        }
      }
    ]);
    expect(debugEntry?.candidateAgent.batches[0]?.request.toolChoice).toBe(
      "required"
    );
    expect(debugEntry?.candidateAgent.batches[0]?.request.attachedImages).toEqual([
      expect.objectContaining({
        name: "hero-bottle.png",
        role: "main-object",
        detail: "high"
      })
    ]);
    expect(
      (
        debugEntry?.candidateAgent.batches[0]?.response.parsed as {
          candidates?: readonly { id: string }[];
        }
      )?.candidates?.[0]
    ).toMatchObject({ id: "candidate-1" });
    expect(debugEntry?.hookAgent.batches[0]?.response.parsed).toMatchObject({
      directions: [expect.objectContaining({ id: "hook-1" })]
    });
    expect(debugEntry?.hookAgent.batches[0]?.response.raw).toBeTruthy();
    expect(debugEntry?.finalResponse).toMatchObject({
      directions: [
        expect.objectContaining({
          id: "hook-1",
          subheadlineHighlight: "visibility กับยอดขาย"
        })
      ]
    });
  });

  it("requires web search inside the Hook Agent in Standard mode", async () => {
    const writeDebugLog = vi.fn(
      async (_directory: string, _entry: HookGenerationDebugLog) => undefined
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(openAiCandidateResponse("candidate-standard"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              directions: [
                {
                  id: "hook-standard",
                  sourceCandidateId: "candidate-standard",
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
        body: JSON.stringify({ ...requestBody, hookIdeaMode: "standard" })
      }),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch,
      writeDebugLog
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const generationBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body)
    ) as { tools?: unknown[]; tool_choice?: string; input: unknown };
    expect(generationBody.tools).toEqual([
      {
        type: "web_search_preview",
        user_location: {
          type: "approximate",
          country: "TH",
          timezone: "Asia/Bangkok"
        }
      }
    ]);
    expect(generationBody.tool_choice).toBe("required");
    expect(JSON.stringify(generationBody.input)).toContain(
      "STANDARD MODE: ค้นอย่างน้อยหนึ่ง query"
    );
    expect(JSON.stringify(generationBody.input)).toContain(
      "query ภาษาไทย"
    );
    expect(JSON.stringify(generationBody.input)).toContain(
      "ห้ามใช้พฤติกรรมผู้บริโภค สถิติ หรือ market context จาก US/global"
    );
    expect(writeDebugLog).not.toHaveBeenCalled();
  });

  it("rewrites Thai UGC when candidate or direction copy uses ฉัน", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(openAiCandidateResponseWithForbiddenUgc())
      .mockResolvedValueOnce(openAiCandidateResponse())
      .mockResolvedValueOnce(openAiUgcDirectionResponse("ฉันเลือกจากการใช้งานจริง"))
      .mockResolvedValueOnce(openAiUgcDirectionResponse("เลือกจากการใช้งานจริง"))
      .mockResolvedValueOnce(highlightResponse("ugc-natural-thai", []));

    const response = await handleHookGenerationHarnessRequest({
      request: new Request("https://moons.local/api/hook-generation-harness", {
        method: "POST",
        body: JSON.stringify(requestBody)
      }),
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const candidateRetryBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body)
    ) as { input: unknown };
    const directionRetryBody = JSON.parse(
      String(fetchMock.mock.calls[3]?.[1]?.body)
    ) as { input: unknown };
    expect(JSON.stringify(candidateRetryBody.input)).toContain(
      "THAI NATURALNESS CORRECTION"
    );
    expect(JSON.stringify(directionRetryBody.input)).toContain(
      "THAI NATURALNESS CORRECTION"
    );
    expect(JSON.stringify(await response.json())).not.toContain("ฉัน");
  });

  it("routes both creative steps through OpenRouter when selected", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(openRouterCandidateResponse())
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
          ...requestBody,
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
        name: "moons_hook_candidates",
        strict: true
      }
    });
    expect(
      JSON.stringify(generationBody.response_format.json_schema.schema)
    ).not.toContain("maxItems");
    expect(
      JSON.stringify(generationBody.response_format.json_schema.schema)
    ).not.toContain("sourceCandidateId");
    expect(generationBody.provider.require_parameters).toBe(true);
    const directorBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body)
    ) as {
      response_format: {
        json_schema: { name: string; schema: unknown };
      };
    };
    expect(directorBody.response_format.json_schema.name).toBe(
      "moons_hook_generation"
    );
    expect(
      JSON.stringify(directorBody.response_format.json_schema.schema)
    ).toContain("sourceCandidateId");
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
      .mockResolvedValueOnce(openRouterCandidateResponse())
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

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(5);
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

  it("keeps raw past posts out of ideation while reusing an abstract brand profile", async () => {
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
              styleSignals: [
                "น้ำเสียงกระชับ มั่นใจ และเว้นบรรทัดก่อน CTA"
              ],
              creativePatterns: [
                {
                  pattern: "diagnostic question",
                  whyItFitsBrand: "แบรนด์ชวนเจ้าของธุรกิจตรวจปัญหาก่อนเสนอทางออก",
                  sourcePostIndexes: [1]
                }
              ],
              reusableDetails: [
                {
                  detail: "ช่องทางติดต่อ LINE: @convertcake",
                  sourcePostIndexes: [1, 2]
                }
              ]
            })
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(openAiCandidateResponse())
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
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              items: [
                {
                  id: "hook-1",
                  caption:
                    "ลูกค้า B2B เริ่มค้นหาคำตอบผ่าน AI แล้ว\n\nจองที่นั่ง Webinar เพื่อวางแผนให้แบรนด์ถูกค้นพบ",
                  contactLine: "LINE: @convertcake"
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
        body: JSON.stringify(requestBody)
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

    expect(fetchMock).toHaveBeenCalledTimes(6);
    const generationBody = JSON.parse(
      String(fetchMock.mock.calls[3]?.[1]?.body)
    ) as { input: unknown };
    const generationPrompt = JSON.stringify(generationBody.input);
    expect(generationPrompt).not.toContain(
      "จองด่วน! Workshop AI SEO รอบนี้ที่นั่งจำกัด"
    );
    expect(generationPrompt).not.toContain(
      "เริ่มวางแผนการตลาดจากข้อมูลที่วัดผลได้"
    );
    expect(generationPrompt).toContain(
      "Caption และ CTA ต้องฟังเหมือนแบรนด์นี้เขียนเอง"
    );
    expect(generationPrompt).toContain(
      "น้ำเสียงกระชับ มั่นใจ และเว้นบรรทัดก่อน CTA"
    );
    expect(generationPrompt).toContain(
      "ช่องทางติดต่อ LINE: @convertcake"
    );
    const captionBody = JSON.parse(
      String(fetchMock.mock.calls[4]?.[1]?.body)
    ) as { input: unknown; text: { format: { name: string } } };
    const captionPrompt = JSON.stringify(captionBody.input);
    expect(captionBody.text.format.name).toBe("moons_caption_style");
    expect(captionPrompt).toContain("# CAPTION STYLIST");
    expect(captionPrompt).toContain(
      "Directions ด้านล่างถูกล็อกแล้ว"
    );
    expect(captionPrompt).toContain(
      "จองด่วน! Workshop AI SEO รอบนี้ที่นั่งจำกัด"
    );
    expect(captionPrompt).toContain("Past posts — style evidence only");
    expect(captionPrompt).toContain("ภาษาไทยห้ามใช้คำว่า ‘ฉัน’");

    const payload = await response.json();
    expect(payload.directions[0]).toMatchObject({
      hook: "ลูกค้า B2B หาเราเจอบน AI หรือยัง?",
      concept: "เปิดด้วยคำถามที่โยง visibility กับยอดขาย",
      caption:
        "ลูกค้า B2B เริ่มค้นหาคำตอบผ่าน AI แล้ว\n\nจองที่นั่ง Webinar เพื่อวางแผนให้แบรนด์ถูกค้นพบ",
      contactLine: "LINE: @convertcake"
    });
    expect(JSON.stringify(payload.directions[0])).not.toContain(
      "จองด่วน! Workshop AI SEO รอบนี้ที่นั่งจำกัด"
    );
    const debugEntry = writeDebugLog.mock.calls[0]?.[1];
    expect(debugEntry?.hookAgent.batches[0]?.request.inputText).not.toContain(
      "จองด่วน! Workshop AI SEO รอบนี้ที่นั่งจำกัด"
    );
    expect(debugEntry?.pastContentAgent?.request.inputText).toContain(
      "จองด่วน! Workshop AI SEO รอบนี้ที่นั่งจำกัด"
    );
    expect(debugEntry?.pastContentAgent?.request.inputText).toContain(
      "กลไกภาษาที่ทำให้งานของแบรนด์จำได้"
    );
    expect(debugEntry?.pastContentAgent?.request.inputText).toContain(
      "ต้องเจาะจงกว่าคำกว้างๆ"
    );
    expect(debugEntry?.pastContentAgent?.response.parsed).toMatchObject({
      styleSignals: ["น้ำเสียงกระชับ มั่นใจ และเว้นบรรทัดก่อน CTA"],
      creativePatterns: [
        expect.objectContaining({ pattern: "diagnostic question" })
      ],
      reusableDetails: [
        expect.objectContaining({
          detail: "ช่องทางติดต่อ LINE: @convertcake"
        })
      ]
    });
    expect(debugEntry?.captionAgent?.request.inputText).toContain(
      "จองด่วน! Workshop AI SEO รอบนี้ที่นั่งจำกัด"
    );
    expect(debugEntry?.captionAgent?.request.responseSchema).toBe(
      "moons_caption_style"
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
      .mockResolvedValueOnce(openAiCandidateResponse("candidate-2"))
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
