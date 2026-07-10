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
  quantity: 3,
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
