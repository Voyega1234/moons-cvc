import { describe, expect, it } from "vitest";
import {
  buildArtworkGenerationRequest,
  buildArtworkGenerationRequests,
  normalizeArtworkOutput
} from "./openai-image-generation";
import { buildN8nArtworkGenerationRequest } from "./n8n-artwork-generation";
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
  artworkMode: "standard",
  imagePromptModel: "gpt-5.6-terra",
  quantity: 1,
  successMetric: "CTR",
  brief: "Launch a soft summer bouquet offer.",
  attachments: [],
  referenceImages: [],
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
    expect(request.artworkMode).toBe("standard");
    expect(request.imagePromptModel).toBe("gpt-5.6-terra");
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
    expect(request.selectedHooks[0]?.visual).toBe(
      "Soft natural light with bouquet on table."
    );
    expect(request.brand).toMatchObject({
      name: "Flora Daily",
      personality: [],
      colors: [],
      mustAvoid: []
    });
    expect(request).not.toHaveProperty("brandMemory");
  });

  it("compacts brand identity fields for the Standard prompt", () => {
    const request = buildArtworkGenerationRequest({
      run: {
        ...run,
        brand: {
          ...run.brand!,
          library: {
            ...run.brand!.library,
            brand: [
              {
                id: "tone",
                title: "Brand personality",
                description: "expert, direct, approachable"
              },
              {
                id: "colors",
                title: "Colors",
                description: "deep blue, bright blue, white"
              }
            ]
          },
          memory: {
            working: [],
            avoid: ["cheap sales graphics", "generic AI robots"]
          }
        }
      }
    });

    expect(request.brand).toMatchObject({
      personality: ["expert", "direct", "approachable"],
      colors: ["deep blue", "bright blue", "white"],
      mustAvoid: ["cheap sales graphics", "generic AI robots"]
    });
  });

  it("passes design-system mode without changing the provider contract", () => {
    const request = buildArtworkGenerationRequest({
      run: { ...run, artworkMode: "design-system" }
    });

    expect(request.artworkMode).toBe("design-system");
    expect(request.model).toBe("gpt-image-2");
    expect(request.selectedHooks).toHaveLength(1);
  });

  it("passes the selected OpenRouter prompt model without changing the image model", () => {
    const request = buildArtworkGenerationRequest({
      run: {
        ...run,
        imagePromptModel: "anthropic/claude-sonnet-4.6"
      }
    });

    expect(request.imagePromptModel).toBe("anthropic/claude-sonnet-4.6");
    expect(request.model).toBe("gpt-image-2");
  });

  it("splits a mixed content plan into existing per-service backend requests", () => {
    const requests = buildArtworkGenerationRequests({
      run: {
        ...run,
        creativeMix: [
          { id: "mix-static", service: "single-static", quantity: 1 },
          { id: "mix-ugc", service: "ugc-video", quantity: 1 }
        ],
        quantity: 2,
        directions: run.directions.map((direction) => ({
          ...direction,
          selected: true
        }))
      }
    });

    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.service)).toEqual([
      "single-static",
      "ugc-video"
    ]);
    expect(requests.map((request) => request.quantity)).toEqual([1, 1]);
    expect(requests[0]?.selectedHooks[0]?.id).toBe("hook-1");
    expect(requests[1]?.selectedHooks[0]?.id).toBe("hook-2");
  });

  it("groups replacement choices by their saved content type, not array position", () => {
    const requests = buildArtworkGenerationRequests({
      run: {
        ...run,
        creativeMix: [
          { id: "mix-static", service: "single-static", quantity: 1 },
          { id: "mix-ugc", service: "ugc-video", quantity: 1 }
        ],
        quantity: 2,
        directions: [
          { ...run.directions[0]!, service: "single-static", selected: false },
          { ...run.directions[1]!, service: "ugc-video", selected: true },
          {
            ...run.directions[0]!,
            id: "hook-static-replacement",
            service: "single-static",
            selected: true
          }
        ]
      }
    });

    expect(requests.map((request) => request.service)).toEqual([
      "single-static",
      "ugc-video"
    ]);
    expect(requests[0]?.selectedHooks[0]?.id).toBe("hook-static-replacement");
    expect(requests[1]?.selectedHooks[0]?.id).toBe("hook-2");
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
      revisionCount: 0,
      approval: { graphicDesign: null, clientService: null, projectManager: null },
      approvalComments: { graphicDesign: "", clientService: "", projectManager: "" }
    });

    expect(output.assetUrl).toContain("creative-assets");
    expect(output.assetStoragePath).toBe("flora/run-1/outputs/hook-1-v1.png");
    expect(output.model).toBe("gpt-image-2");
  });

  it("adds the logo and selected reference URLs to the n8n request", () => {
    const brandedRun: WorkflowState = {
      ...run,
      brand: {
        ...run.brand!,
        library: {
          ...run.brand!.library,
          brand: [
            {
              id: "logo",
              title: "Logo",
              description: "Primary logo",
              assetUrl: "https://assets.example.com/flora-logo.png"
            }
          ]
        }
      }
    };
    const request = buildArtworkGenerationRequest({
      run: brandedRun,
      referenceImages: [
        {
          kind: "url",
          url: "https://assets.example.com/reference.png",
          label: "Reference mood"
        }
      ]
    });

    const n8nRequest = buildN8nArtworkGenerationRequest({
      request,
      brand: brandedRun.brand
    });

    expect(n8nRequest.logoUrl).toBe("https://assets.example.com/flora-logo.png");
    expect(n8nRequest.referenceImageUrls).toEqual([
      {
        url: "https://assets.example.com/reference.png",
        label: "Reference mood"
      }
    ]);
    expect(n8nRequest.selectedHooks).toEqual(request.selectedHooks);
    expect(n8nRequest).not.toHaveProperty("brandMemory");
  });
});
