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
  outputSize: "1024x1024",
  quantity: 1,
  successMetric: "CTR",
  brief: "Launch a soft summer bouquet offer.",
  attachments: [],
  uploadedMaterials: [],
  referenceImages: [],
  ideaGenerationStatus: "idle",
  ideaGenerationError: null,
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
      colors: []
    });
    expect(request.brand).not.toHaveProperty("mustAvoid");
    expect(request).not.toHaveProperty("brandMemory");
  });

  it("passes the selected output size to the backend contract", () => {
    const request = buildArtworkGenerationRequest({
      run: {
        ...run,
        outputSize: "2160x3840"
      }
    });

    expect(request.output.size).toBe("2160x3840");
  });

  it("replaces a stale selected logo with the active client's Brand Kit logo", () => {
    const request = buildArtworkGenerationRequest({
      run: {
        ...run,
        brand: {
          ...run.brand!,
          library: {
            ...run.brand!.library,
            brand: [
              {
                id: "flora-logo",
                title: "Logo",
                description: "Flora Daily logo",
                assetUrl: "https://example.com/flora-logo.png"
              }
            ]
          }
        }
      },
      referenceImages: [
        {
          kind: "url",
          url: "https://example.com/sleep-happy-logo.png",
          label: "Logo"
        },
        {
          kind: "url",
          url: "https://example.com/flora-past-work.png",
          label: "Past work"
        }
      ]
    });

    expect(request.referenceImages).toEqual([
      {
        kind: "url",
        url: "https://example.com/flora-logo.png",
        label: "Logo"
      },
      {
        kind: "url",
        url: "https://example.com/flora-past-work.png",
        label: "Past work"
      }
    ]);
  });

  it("passes uploaded creative materials to artwork generation with their intended role", () => {
    const request = buildArtworkGenerationRequest({
      run: {
        ...run,
        uploadedMaterials: [
          {
            id: "material-1",
            name: "bouquet.png",
            mediaType: "image/png",
            role: "main-object",
            description: "Keep this bouquet as the hero",
            url: "https://example.com/bouquet.png"
          }
        ]
      }
    });

    expect(request.referenceImages).toEqual([
      expect.objectContaining({
        kind: "url",
        url: "https://example.com/bouquet.png",
        label: expect.stringContaining("main object")
      })
    ]);
    expect(request.referenceImages[0]?.label).toContain(
      "Keep this bouquet as the hero"
    );
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
                description: "#0A1628, #1A56DB"
              },
              {
                id: "secondary-colors",
                title: "Secondary colors",
                description: "#00D4FF"
              },
              {
                id: "visual-guidance",
                title: "Visual guidance",
                description:
                  "Mood: confident\nColor palette: #111111, warm blue, #222222\nLayout: clean"
              },
              {
                id: "bad-colors",
                title: "Campaign notes",
                description: "premium, direct, this should not be parsed"
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
      colors: ["#0A1628", "#1A56DB", "#00D4FF", "#111111", "#222222"]
    });
    expect(request.brand).not.toHaveProperty("mustAvoid");
    expect(request.brand?.colors).not.toContain("warm blue");
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

  it("sends image requests for visual formats and keeps UGC in the local template", () => {
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

    expect(requests).toHaveLength(1);
    expect(requests.map((request) => request.service)).toEqual(["single-static"]);
    expect(requests.map((request) => request.quantity)).toEqual([1]);
    expect(requests[0]?.selectedHooks[0]?.id).toBe("hook-1");
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

    expect(requests.map((request) => request.service)).toEqual(["single-static"]);
    expect(requests[0]?.selectedHooks[0]?.id).toBe("hook-static-replacement");
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
