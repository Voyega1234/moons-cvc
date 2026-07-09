import { describe, expect, it } from "vitest";
import {
  buildArtworkGenerationRequest,
  normalizeArtworkOutput
} from "./openai-image-generation";
import type { WorkflowState } from "../../features/workflow/model";

const run: WorkflowState = {
  id: "run-1",
  createdAt: "2026-06-26T00:00:00.000Z",
  updatedAt: "2026-06-26T00:00:00.000Z",
  stage: "directions",
  brand: {
    id: "flora",
    name: "Flora Daily",
    category: "Flowers / lifestyle",
    initials: "FD",
    library: { brand: [], products: [], docs: [], refs: [] },
    memory: { working: [], avoid: [] }
  },
  brandMenuOpen: false,
  brandSearch: "",
  librarySection: "brand",
  service: "single-static",
  quantity: 1,
  brief: "Launch a soft summer bouquet offer.",
  attachments: [],
  directions: [
    {
      id: "hook-1",
      hook: "Flowers that make the room feel softer",
      concept: "Lead with room mood.",
      why: "Connects the offer to a clear room mood.",
      visual: "Soft natural light with bouquet on table.",
      cta: "Order a bouquet",
      caption: "Fresh flowers for calm homes.",
      selected: true
    },
    {
      id: "hook-2",
      hook: "Your weekend table, upgraded",
      concept: "Occasion-led hook.",
      why: "Makes the product feel immediately useful.",
      visual: "Dining table setup.",
      cta: "Shop this weekend",
      caption: "Order this weekend.",
      selected: false
    }
  ],
  outputs: [],
  qaComplete: false,
  approved: false,
  clientSent: false,
  done: false
};

describe("buildArtworkGenerationRequest", () => {
  it("passes brief, selected hooks, text inputs, and reference images to the backend contract", () => {
    const request = buildArtworkGenerationRequest({
      run,
      textInputs: ["Keep it calm and premium."],
      referenceImages: [
        {
          kind: "url",
          url: "https://example.com/reference.png",
          label: "Reference mood"
        }
      ]
    });

    expect(request.model).toBe("gpt-image-2");
    expect(request.brief).toBe(run.brief);
    expect(request.selectedHooks).toHaveLength(1);
    expect(request.selectedHooks[0]?.hook).toBe(
      "Flowers that make the room feel softer"
    );
    expect(request.textInputs).toEqual(["Keep it calm and premium."]);
    expect(request.referenceImages[0]).toMatchObject({
      kind: "url",
      url: "https://example.com/reference.png"
    });
  });

  it("keeps returned assets as links and storage metadata, not base64 payloads", () => {
    const output = normalizeArtworkOutput({
      id: "output-1",
      directionId: "hook-1",
      format: "1:1 Static",
      status: "draft",
      clientStatus: "queued",
      assetUrl:
        "https://example.supabase.co/storage/v1/object/sign/creative-assets/flora/run-1/output.png",
      assetStoragePath: "flora/run-1/outputs/hook-1-v1.png",
      assetBucket: "creative-assets",
      provider: "openai",
      model: "gpt-image-2",
      revisionCount: 0
    });

    expect(output.assetUrl).toContain("creative-assets");
    expect(output.assetStoragePath).toBe("flora/run-1/outputs/hook-1-v1.png");
    expect(output.model).toBe("gpt-image-2");
  });
});
