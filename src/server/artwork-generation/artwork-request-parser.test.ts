import { describe, expect, it } from "vitest";
import { parseRequestBody } from "./artwork-request-parser";

describe("parseRequestBody", () => {
  it("rejects persisted Visual guidance from artwork agent input", () => {
    const parsed = parseRequestBody({
      model: "gpt-image-2",
      artworkMode: "standard",
      imagePromptModel: "gpt-5.6-terra",
      runId: "run-1",
      brand: null,
      service: "single-static",
      quantity: 1,
      brief: "Campaign brief",
      selectedHooks: [
        {
          id: "hook-1",
          hook: "Hook",
          concept: "Concept",
          why: "Why",
          visual: "Visual",
          cta: "CTA",
          caption: "Caption"
        }
      ],
      textInputs: [],
      referenceImages: [],
      brandLibrary: {
        brand: [
          { title: "Brand Details", description: "Active context" },
          { title: "Visual guidance", description: "Legacy visual analysis" }
        ],
        products: [],
        docs: [],
        refs: []
      },
      output: { size: "1024x1024", format: "png" }
    });

    expect(parsed.brandLibrary.brand).toEqual([
      { title: "Brand Details", description: "Active context" }
    ]);
  });
});
