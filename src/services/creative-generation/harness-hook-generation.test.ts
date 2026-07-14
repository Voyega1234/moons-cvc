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
    }
  },
  brandMenuOpen: false,
  brandSearch: "",
  librarySection: "brand",
  service: "single-static",
  artworkMode: "standard",
  imagePromptModel: "gpt-5.6-terra",
  quantity: 3,
  successMetric: "CTR",
  brief: "Generate hooks for AI SEO webinar.",
  attachments: ["brief.pdf"],
  referenceImages: [],
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
    expect(request.brief).toBe("Generate hooks for AI SEO webinar.");
    expect(request.brandMemory.working).toEqual(["Thai B2B examples work well."]);
    expect(request.brandLibrary.products[0]).toMatchObject({
      title: "AI SEO Workshop"
    });
    expect(request.attachments).toEqual(["brief.pdf"]);
    expect(request.contentTypeQuotas).toEqual([
      { service: "single-static", count: 3 }
    ]);
  });

  it("preserves every Creative mix type and quantity in the backend contract", () => {
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

    expect(request.quantity).toBe(6);
    expect(request.contentTypeQuotas).toEqual([
      { service: "single-static", count: 3 },
      { service: "album-post", count: 1 },
      { service: "ugc-video", count: 2 }
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
              cta: "ปรึกษาทีม SEO",
              caption: "เริ่มแก้จากโครงสร้างที่ Search อ่านได้"
            }
          ]
        })
      )
    );

    const [direction] = await generateDirectionsWithHarness({ run });

    expect(direction).toMatchObject({
      subheadline: "ทำโครงสร้างเว็บไซต์ให้ Search เข้าใจธุรกิจได้ชัดขึ้น",
      concept: "ชวนเจ้าของแบรนด์มอง SEO ผ่านโครงสร้างเว็บไซต์",
      subheadlineHighlight: "โครงสร้างเว็บไซต์"
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
