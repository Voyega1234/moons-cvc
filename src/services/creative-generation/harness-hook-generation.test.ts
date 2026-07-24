import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  buildHookGenerationHarnessRequest,
  generateDirectionsWithHarness
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

  it("adds two candidates to every active Creative mix type", () => {
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

  it("maps existing directions and extra instructions for a generate-more request", () => {
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
    expect(request.existingHooks).toEqual([
      { hook: "เรียนรู้ AI SEO ใน 1 วัน", concept: "Workshop urgency" }
    ]);
  });

  it("defaults extraInstructions to an empty string when omitted", () => {
    const request = buildHookGenerationHarnessRequest({ run });
    expect(request.extraInstructions).toBe("");
    expect(request.existingHooks).toEqual([]);
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
                openingScript: "เปิดนาฬิกาแล้วพูดว่าเหลือเวลาไม่ถึง 10 นาที",
                showcaseScript: "เทไข่ลงกระทะและถ่าย close-up เนื้อไข่ข้น",
                closingScript: "ยกจานขึ้นชิมแล้วชวนเลือก Colormic 24cm"
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
      moodAndTone: "สดใส เป็นธรรมชาติ คล่องตัว",
      openingScript: "เปิดนาฬิกาแล้วพูดว่าเหลือเวลาไม่ถึง 10 นาที"
    });
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
