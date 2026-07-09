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
