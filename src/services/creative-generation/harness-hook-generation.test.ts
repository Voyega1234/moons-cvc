import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  buildHookGenerationHarnessRequest,
  generateDirectionsWithHarness,
  generateHookResearchWithHarness
} from "./harness-hook-generation";
import type { WorkflowState } from "../../features/workflow/model";

const run: WorkflowState = {
  id: "run-1",
  createdAt: "2026-07-09T00:00:00.000Z",
  updatedAt: "2026-07-09T00:00:00.000Z",
  stage: "brief",
  albumFormat: "three-horizontal",
  brand: {
    id: "convert-cake",
    name: "Convert Cake",
    category: "AI marketing agency",
    initials: "CC",
    library: {
      brand: [{ id: "b1", title: "Positioning", description: "AI marketing" }],
      products: [
        {
          id: "p1",
          title: "AI SEO Workshop",
          description: "Webinar for B2B owners"
        },
        {
          id: "p2",
          title: "Creative Strategy Workshop",
          description: "Workshop for marketing teams"
        }
      ],
      docs: [],
      refs: []
    },
    memory: {
      working: ["Thai B2B examples work well."],
      avoid: ["Avoid luxury styling."]
    },
    onboardingQuestionnaire: {
      sourceUrl: "https://example.com/onboarding",
      text: "Onboarding answer: B2B owners need practical AI guidance.",
      preview: "Onboarding answer: B2B owners need practical AI guidance.",
      facebookUrls: []
    }
  },
  brandMenuOpen: false,
  brandSearch: "",
  librarySection: "brand",
  service: "single-static",
  hookIdeaMode: "standard",
  hookGenerationModel: "gpt-5.6-terra",
  artworkMode: "standard",
  imagePromptModel: "gpt-5.6-terra",
  outputSize: "1024x1024",
  quantity: 3,
  successMetric: "CTR",
  brief: "Generate hooks for AI SEO webinar.",
  attachments: ["brief.pdf"],
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
  referenceImages: [],
  ideaGenerationStatus: "idle",
  ideaGenerationError: null,
  artworkGenerationStatus: "idle",
  artworkGenerationError: null,
  directions: [],
  outputs: [],
  qaComplete: false,
  approved: false,
  clientSent: false,
  done: false
};

describe("buildHookGenerationHarnessRequest", () => {
  it("passes brief, brand memory, products, and attachments to the backend contract", () => {
    const request = buildHookGenerationHarnessRequest({ run });

    expect(request.brand?.name).toBe("Convert Cake");
    expect(request.hookIdeaMode).toBe("standard");
    expect(request.generationModel).toBe("gpt-5.6-terra");
    expect(request.albumFormat).toBe("three-horizontal");
    expect(request.brief).toBe("Generate hooks for AI SEO webinar.");
    expect(request.onboardingQuestionnaire).toBe(
      "Onboarding questionnaire — historical onboarding context only; not the current campaign brief.\n\n" +
        "Onboarding answer: B2B owners need practical AI guidance."
    );
    expect(request.brandMemory.working).toEqual(["Thai B2B examples work well."]);
    expect(request.brandLibrary.products[0]).toMatchObject({
      title: "AI SEO Workshop"
    });
    expect(request.attachments).toEqual(["brief.pdf"]);
    expect(request.uploadedMaterials).toEqual([
      expect.objectContaining({
        name: "hero-bottle.png",
        role: "main-object",
        description: "Keep the bottle as the hero object"
      })
    ]);
    expect(request.quantity).toBe(5);
    expect(request.contentTypeQuotas).toEqual([
      { service: "single-static", count: 5 }
    ]);
  });

  it("adds two finished options to every active Creative mix type", () => {
    const request = buildHookGenerationHarnessRequest({
      run: {
        ...run,
        creativeMix: [
          { id: "static", service: "single-static", quantity: 3 },
          { id: "album", service: "album-post", quantity: 1 },
          { id: "ugc", service: "ugc-video", quantity: 2 }
        ],
        quantity: 6
      }
    });

    expect(request.quantity).toBe(12);
    expect(request.contentTypeQuotas).toEqual([
      { service: "single-static", count: 5 },
      { service: "album-post", count: 3 },
      { service: "ugc-video", count: 4 }
    ]);
  });

  it("sends only products selected in Product truth", () => {
    const request = buildHookGenerationHarnessRequest({
      run: { ...run, selectedProductIds: ["p2"] }
    });

    expect(request.brandLibrary.products).toEqual([
      {
        title: "Creative Strategy Workshop",
        description: "Workshop for marketing teams"
      }
    ]);
  });

  it("omits zero-count Creative mix types from the backend contract", () => {
    const request = buildHookGenerationHarnessRequest({
      run: {
        ...run,
        creativeMix: [
          { id: "static", service: "single-static", quantity: 2 },
          { id: "ugc", service: "ugc-video", quantity: 0 },
          { id: "album", service: "album-post", quantity: 0 }
        ],
        quantity: 2
      }
    });

    expect(request.quantity).toBe(4);
    expect(request.contentTypeQuotas).toEqual([
      { service: "single-static", count: 4 }
    ]);
  });

  it("does not send existing directions with a generate-more request", () => {
    const runWithDirections: WorkflowState = {
      ...run,
      directions: [
        {
          id: "direction-1",
          hook: "เรียนรู้ AI SEO ใน 1 วัน",
          concept: "Workshop urgency",
          why: "Creates urgency for a limited seat webinar.",
          visual: "Clean, professional.",
          cta: "จองที่นั่ง",
          caption: "จองด่วน!",
          selected: false
        }
      ]
    };

    const request = buildHookGenerationHarnessRequest({
      run: runWithDirections,
      extraInstructions: "Focus more on small business owners this round."
    });

    expect(request.extraInstructions).toBe(
      "Focus more on small business owners this round."
    );
    expect(request).not.toHaveProperty("existingHooks");
  });

  it("defaults extraInstructions to an empty string when omitted", () => {
    const request = buildHookGenerationHarnessRequest({ run });
    expect(request.extraInstructions).toBe("");
    expect(request).not.toHaveProperty("existingHooks");
  });

  it("uses an empty onboarding questionnaire when the brand has none", () => {
    const request = buildHookGenerationHarnessRequest({
      run: { ...run, brand: null }
    });

    expect(request.onboardingQuestionnaire).toBe("");
  });

  it("sends only Hook Agent-relevant extracted questionnaire fields", () => {
    const request = buildHookGenerationHarnessRequest({
      run: {
        ...run,
        brand: {
          ...run.brand!,
          onboardingQuestionnaire: {
            sourceUrl: "https://example.com/onboarding",
            text: "Full stored questionnaire text",
            preview: "Full stored questionnaire text",
            facebookUrls: [],
            extractedFields: [
              {
                key: "brand_description",
                label: "Brand description",
                value: "Thai hospitality group"
              },
              {
                key: "contact_primary_email",
                label: "Contact primary email",
                value: "private@example.com"
              },
              {
                key: "marketing_monthly_budget",
                label: "Marketing monthly budget",
                value: "90,000"
              },
              {
                key: "products_target_customer",
                label: "Products target customer",
                value: "Travellers aged 25–55"
              },
              {
                key: "creative_restrictions",
                label: "Creative restrictions",
                value: "Do not promote alcohol"
              },
              {
                key: "creative_has_brand_guideline",
                label: "Creative has brand guideline",
                value: "https://drive.google.com/example"
              }
            ]
          }
        }
      }
    });

    expect(request.onboardingQuestionnaire).toBe(
      "Onboarding questionnaire — historical onboarding context only; not the current campaign brief.\n\n" +
        "Brand description [brand_description]\nThai hospitality group\n\n" +
        "Products target customer [products_target_customer]\nTravellers aged 25–55\n\n" +
        "Creative restrictions [creative_restrictions]\nDo not promote alcohol"
    );
    expect(request.onboardingQuestionnaire).not.toContain("private@example.com");
    expect(request.onboardingQuestionnaire).not.toContain("90,000");
    expect(request.onboardingQuestionnaire).not.toContain("drive.google.com");
  });

  it("keeps generated subheadline copy separate from the internal concept", async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          directions: [
            {
              id: "direction-1",
              service: "single-static",
              hook: "เว็บสวย แต่ Google อาจยังอ่านไม่ออก",
              subheadline: "ทำโครงสร้างเว็บไซต์ให้ Search เข้าใจธุรกิจได้ชัดขึ้น",
              concept: "ชวนเจ้าของแบรนด์มอง SEO ผ่านโครงสร้างเว็บไซต์",
              subheadlineHighlight: "โครงสร้างเว็บไซต์",
              why: "Makes the technical issue concrete.",
              visual: "Search result beside a website structure diagram.",
              formatBeats: [],
              cta: "ปรึกษาทีม SEO",
              caption: "เริ่มแก้จากโครงสร้างที่ Search อ่านได้",
              score: 87
            }
          ]
        })
      )
    );

    const [direction] = await generateDirectionsWithHarness({ run });

    expect(direction).toMatchObject({
      subheadline: "ทำโครงสร้างเว็บไซต์ให้ Search เข้าใจธุรกิจได้ชัดขึ้น",
      concept: "ชวนเจ้าของแบรนด์มอง SEO ผ่านโครงสร้างเว็บไซต์",
      subheadlineHighlight: "โครงสร้างเว็บไซต์",
      formatBeats: [],
      score: 87
    });
    vi.stubGlobal("fetch", originalFetch);
  });

  it("preserves an intentionally empty generated subheadline", async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          directions: [
            {
              id: "direction-1",
              service: "single-static",
              hook: "ทิชชู่หนึ่งหิ้ว ใช้ได้ทั้งบ้าน",
              subheadline: "",
              concept: "สื่อสาร pack truth และ practical benefit ในบรรทัดเดียว",
              why: "The headline already carries the complete message.",
              visual: "One pack serving several rooms.",
              formatBeats: [],
              cta: "เลือกแพ็กที่เหมาะกับบ้าน",
              caption: "หนึ่งหิ้วพร้อมใช้ในทุกห้อง",
              score: 90
            }
          ]
        })
      )
    );

    const [direction] = await generateDirectionsWithHarness({ run });

    expect(direction?.subheadline).toBe("");
    expect(direction?.subheadlineHighlight).toBe("");
    vi.stubGlobal("fetch", originalFetch);
  });

  it("keeps an omitted generated subheadline empty instead of copying concept", async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          directions: [
            {
              id: "direction-without-subheadline",
              service: "single-static",
              hook: "Headline นี้จบความหมายในตัวเอง",
              concept: "Internal concept must not leak into artwork copy",
              why: "The headline needs no supporting line.",
              visual: "One focused visual.",
              formatBeats: [],
              cta: "ดูรายละเอียด",
              caption: "รายละเอียดสำหรับแคปชัน",
              score: 90
            }
          ]
        })
      )
    );

    const [direction] = await generateDirectionsWithHarness({ run });

    expect(direction?.subheadline).toBe("");
    expect(direction?.subheadlineHighlight).toBe("");
    vi.stubGlobal("fetch", originalFetch);
  });

  it("preserves the production-ready UGC brief returned by hook generation", async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          directions: [
            {
              id: "ugc-1",
              service: "ugc-video",
              hook: "เช้ารีบแค่ไหน ไข่ข้นก็ยังทัน",
              subheadline: "ทำมื้อเช้าจานโปรดให้เสร็จก่อนออกจากบ้าน",
              concept: "Creator สาธิตเมนูเช้าจริงในครัวที่มีเวลาจำกัด",
              why: "ทำให้ use case ของกระทะเข้าใจได้ทันที",
              visual: "Natural morning light, native vertical video.",
              formatBeats: ["เปิดด้วยเวลาที่ใกล้หมด", "สาธิตทำไข่ข้น", "ชิมและปิดด้วย CTA"],
              ugcBrief: {
                product: "Korea King Colormic 24cm",
                duration: "15–30 วินาที",
                objective: "ทำให้คนเห็นว่ากระทะเหมาะกับเมนูเช้าที่ทำได้เร็ว",
                moodAndTone: "สดใส เป็นธรรมชาติ คล่องตัว",
                productionStyle: "Handheld creator POV สลับ close-up อาหาร",
                referenceDirection: "UGC ครัวเช้า แสงธรรมชาติ และ text overlay สั้น",
                scenes: [
                  {
                    title: "HOOK",
                    duration: "0–5 วินาที",
                    scriptLines: ["เช้านี้เหลือเวลาไม่ถึง 10 นาที แต่ยังอยากกินไข่ข้นดี ๆ อยู่ไหม?"],
                    visual: "เปิดนาฬิกาแล้วหันมาพูดกับกล้อง",
                    textOverlay: "มื้อเช้าใน 10 นาที"
                  },
                  {
                    title: "DEVELOPMENT",
                    duration: "5–15 วินาที",
                    scriptLines: ["แค่เทไข่ลงกระทะ Colormic แล้วคนเบา ๆ ก็ได้เนื้อไข่นุ่มข้น"],
                    visual: "สาธิตเทไข่และคนในกระทะ",
                    textOverlay: "ทำง่าย ไม่ติดกระทะ"
                  },
                  {
                    title: "PROOF / BENEFIT",
                    duration: "15–25 วินาที",
                    scriptLines: ["กระทะร้อนทั่วถึง ทำให้ไข่สุกสวยโดยไม่ต้องใช้น้ำมันเยอะ"],
                    visual: "ถ่าย close-up เนื้อไข่ข้นและผิวกระทะ",
                    textOverlay: "ร้อนทั่วถึง ใช้น้ำมันน้อย"
                  },
                  {
                    title: "CTA",
                    duration: "25–30 วินาที",
                    scriptLines: ["เช้าที่รีบก็ยังอร่อยได้ เลือก Colormic 24cm ไว้ติดครัวเลย"],
                    visual: "ยกจานขึ้นชิมแล้วชูกระทะให้เห็น",
                    textOverlay: "เลือก Colormic 24cm"
                  }
                ]
              },
              cta: "เลือก Colormic 24cm",
              caption: "มื้อเช้าที่รีบก็ยังทำให้น่ากินได้",
              score: 89
            }
          ]
        })
      )
    );

    const [direction] = await generateDirectionsWithHarness({
      run: { ...run, service: "ugc-video" }
    });

    expect(direction?.ugcBrief).toMatchObject({
      product: "Korea King Colormic 24cm",
      duration: "15–30 วินาที",
      moodAndTone: "สดใส เป็นธรรมชาติ คล่องตัว"
    });
    expect(direction?.ugcBrief?.scenes).toHaveLength(4);
    expect(direction?.ugcBrief?.scenes[0]).toMatchObject({
      title: "HOOK",
      scriptLines: ["เช้านี้เหลือเวลาไม่ถึง 10 นาที แต่ยังอยากกินไข่ข้นดี ๆ อยู่ไหม?"]
    });
    vi.stubGlobal("fetch", originalFetch);
  });

  it("requests Research once and reuses its dossier for generation", async () => {
    const originalFetch = globalThis.fetch;
    const dossier = {
      summary: "Shared evidence",
      references: [],
      insights: [],
      gaps: []
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ researchDossier: dossier }))
      .mockResolvedValueOnce(
        Response.json({
          directions: [
            {
              id: "shared-research-direction",
              service: "single-static",
              hook: "หนึ่ง Research ใช้ได้กับทุกโมเดล",
              subheadline: "ลดเวลารอและงานซ้ำ",
              concept: "Shared dossier",
              why: "Keeps model comparison consistent.",
              visual: "One dossier branching to model outputs.",
              formatBeats: [],
              cta: "ดูผลเปรียบเทียบ",
              caption: "เปรียบเทียบไอเดียจากหลักฐานชุดเดียวกัน",
              score: 90
            }
          ]
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const researchDossier = await generateHookResearchWithHarness({ run });
    await generateDirectionsWithHarness({ run, researchDossier });

    const researchBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body)
    ) as { researchOnly?: boolean };
    const generationBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body)
    ) as { researchDossier?: unknown; researchOnly?: boolean };
    expect(researchBody.researchOnly).toBe(true);
    expect(generationBody.researchOnly).toBeUndefined();
    expect(generationBody.researchDossier).toEqual(dossier);

    vi.stubGlobal("fetch", originalFetch);
  });

  it("retries once when the harness HTTP boundary returns a non-JSON body", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("<html>Temporary gateway response</html>", {
          status: 502,
          headers: { "Content-Type": "text/html" }
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          directions: [
            {
              id: "direction-recovered",
              service: "single-static",
              hook: "กลับมาสร้างไอเดียได้สำเร็จ",
              subheadline: "ระบบกู้คืนจากคำตอบชั่วคราวของ gateway",
              concept: "Recovered request",
              why: "Keeps the run moving after one transient response.",
              visual: "Clear recovery signal.",
              formatBeats: [],
              cta: "ดูรายละเอียด",
              caption: "สร้างไอเดียต่อได้",
              score: 85
            }
          ]
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const [direction] = await generateDirectionsWithHarness({ run });

    expect(direction?.id).toBe("direction-recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.stubGlobal("fetch", originalFetch);
  });

  it("recovers when a non-JSON runtime 500 succeeds on the bounded retry", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("FUNCTION_INVOCATION_FAILED", {
          status: 500,
          headers: { "x-vercel-id": "dev1::failed-once" }
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          directions: [
            {
              id: "direction-after-runtime-restart",
              service: "single-static",
              hook: "Runtime ใหม่รับงานต่อได้",
              subheadline: "ไม่ต้องให้ผู้ใช้เริ่มทั้งรอบใหม่",
              concept: "Bounded runtime recovery",
              why: "Recovers one transient worker failure.",
              visual: "A completed model result after a worker restart.",
              formatBeats: [],
              cta: "ดูผลลัพธ์",
              caption: "ระบบลองใหม่เพียงครั้งเดียว",
              score: 88
            }
          ]
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const [direction] = await generateDirectionsWithHarness({ run });

    expect(direction?.id).toBe("direction-after-runtime-restart");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.stubGlobal("fetch", originalFetch);
  });

  it("does not replay a timed-out hook run after a non-JSON gateway response", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () =>
      new Response("<html>FUNCTION_INVOCATION_TIMEOUT</html>", {
        status: 504,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "x-vercel-id": "dev1::timeout-1"
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateDirectionsWithHarness({ run })).rejects.toThrow(
      "Harness hook generation returned HTML instead of JSON after 1 attempt (504, text/html; charset=utf-8, request dev1::timeout-1)."
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.stubGlobal("fetch", originalFetch);
  });

  it("retries a non-JSON 500 response once and then stops", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () =>
      new Response("FUNCTION_INVOCATION_FAILED", {
        status: 500,
        headers: { "x-vercel-id": "dev1::failed-1" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateDirectionsWithHarness({ run })).rejects.toThrow(
      "Harness hook generation returned a non-JSON body instead of JSON after 2 attempts (500, text/plain;charset=UTF-8, request dev1::failed-1)."
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.stubGlobal("fetch", originalFetch);
  });

  it("reports an empty backend response clearly", async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 200 }))
    );

    await expect(generateDirectionsWithHarness({ run })).rejects.toThrow(
      "Harness hook generation returned an empty response body."
    );

    vi.stubGlobal("fetch", originalFetch);
  });
});
