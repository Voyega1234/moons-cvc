import { describe, expect, it } from "vitest";
import {
  artworkReferencesFromSelections,
  buildArtworkGenerationRequest,
  buildArtworkGenerationRequests,
  buildArtworkRegenerationRequest,
  buildArtworkRevisionRequest,
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
  hookIdeaMode: "standard",
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
  artworkGenerationStatus: "idle",
  artworkGenerationError: null,
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
  it("orders the primary reference first and includes its selected role", () => {
    expect(
      artworkReferencesFromSelections([
        {
          id: "style-1",
          url: "https://example.com/style.png",
          label: "Minimal living room",
          role: "style"
        },
        {
          id: "product-1",
          url: "https://example.com/product.png",
          label: "Official packshot",
          role: "product",
          primary: true
        }
      ])
    ).toEqual([
      {
        kind: "url",
        url: "https://example.com/product.png",
        label: "Primary reference · Product · Official packshot"
      },
      {
        kind: "url",
        url: "https://example.com/style.png",
        label: "Supporting reference · Style · Minimal living room"
      }
    ]);
  });

  it("keeps the legacy full generation request for album regeneration", () => {
    const direction = run.directions[0];
    if (!direction) throw new Error("Expected a selected direction fixture.");

    const request = buildArtworkRegenerationRequest({
      run,
      direction,
      sourceImageUrl: "https://example.com/current-artwork.png",
      extraInstructions: "Fix hierarchy and make the CTA more direct."
    });

    expect(request.quantity).toBe(1);
    expect(request.textInputs).toEqual([
      "Fix hierarchy and make the CTA more direct."
    ]);
    expect(request.referenceImages[0]).toEqual({
      kind: "url",
      url: "https://example.com/current-artwork.png",
      label: "Current artwork to revise"
    });
  });

  it("preserves Design System album service and story beats during regeneration", () => {
    const direction = run.directions[0];
    if (!direction) throw new Error("Expected a selected direction fixture.");
    const albumDirection = {
      ...direction,
      service: "album-post" as const,
      formatBeats: ["Cover tension", "Proof mechanism", "Offer close"]
    };

    const request = buildArtworkRegenerationRequest({
      run: {
        ...run,
        artworkMode: "design-system",
        service: "album-post",
        creativeMix: [
          { id: "album", service: "album-post", quantity: 1 }
        ],
        directions: [albumDirection]
      },
      direction: albumDirection,
      extraInstructions: "Strengthen hierarchy across the full album."
    });

    expect(request.artworkMode).toBe("design-system");
    expect(request.service).toBe("album-post");
    expect(request.selectedHooks[0]?.formatBeats).toEqual([
      "Cover tension",
      "Proof mechanism",
      "Offer close"
    ]);
  });

  it("builds a minimal current-image plus instructions request for controlled revision", () => {
    const request = buildArtworkRevisionRequest({
      run,
      output: {
        id: "hook-1-v1",
        directionId: "hook-1",
        format: "1:1 Static",
        status: "ready",
        clientStatus: "queued",
        assetUrl: "https://example.com/current-artwork.png",
        revisionCount: 0,
        approval: {
          graphicDesign: null,
          clientService: null,
          projectManager: null
        },
        approvalComments: {
          graphicDesign: "",
          clientService: "",
          projectManager: ""
        }
      },
      instructions: "  Increase whitespace around the CTA.  "
    });

    expect(request).toEqual({
      requestType: "artwork-revision",
      model: "gpt-image-2",
      clientId: "flora",
      runId: "run-1",
      outputId: "hook-1-v1",
      directionId: "hook-1",
      assetVersion: 2,
      format: "1:1 Static",
      sourceImageUrl: "https://example.com/current-artwork.png",
      instructions: "Increase whitespace around the CTA.",
      output: { size: "1024x1024", format: "png" }
    });
    expect(request).not.toHaveProperty("brief");
    expect(request).not.toHaveProperty("selectedHooks");
    expect(request).not.toHaveProperty("referenceImages");
    expect(request).not.toHaveProperty("imagePromptModel");
  });

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
    expect(request.brandMemory).toEqual({ working: [], avoid: [] });
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

  it("attaches an uploaded image guideline as a visual Brand CI input", () => {
    const request = buildArtworkGenerationRequest({
      run: {
        ...run,
        brand: {
          ...run.brand!,
          library: {
            ...run.brand!.library,
            brand: [
              {
                id: "ci-1",
                title: "Brand CI / Guideline",
                description: "Use generous spacing and the approved type family.",
                assetUrl:
                  "https://example.supabase.co/storage/brand-ci.png?token=signed"
              }
            ]
          }
        }
      }
    });

    expect(request.referenceImages).toContainEqual({
      kind: "url",
      url: "https://example.supabase.co/storage/brand-ci.png?token=signed",
      label:
        "Brand CI / Guideline source — follow its identity, typography, color, spacing, imagery, and logo rules; do not copy sample campaign content"
    });
    expect(request.brandLibrary.brand[0]?.description).toContain(
      "approved type family"
    );
  });

  it("keeps the latest selected logo instead of the stale brand snapshot logo", () => {
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
                description: "Old extracted logo",
                assetUrl: "https://example.com/extracted-black-white-logo.png"
              }
            ]
          }
        }
      },
      referenceImages: [
        {
          kind: "url",
          url: "https://example.com/user-uploaded-color-logo.png",
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
        url: "https://example.com/user-uploaded-color-logo.png",
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

  it("splits high-volume artwork into bounded batches", () => {
    const source = run.directions[0];
    if (!source) throw new Error("Expected a direction fixture.");
    const directions = Array.from({ length: 10 }, (_, index) => ({
      ...source,
      id: `hook-${index + 1}`,
      service: "single-static" as const,
      selected: true
    }));

    const requests = buildArtworkGenerationRequests({
      run: {
        ...run,
        creativeMix: [
          { id: "mix-static", service: "single-static", quantity: 10 }
        ],
        quantity: 10,
        directions
      }
    });

    expect(requests.map((request) => request.quantity)).toEqual([4, 4, 2]);
    expect(requests.flatMap((request) => request.selectedHooks)).toHaveLength(10);
  });

  it("resumes a partial artwork run without regenerating completed directions", () => {
    const requests = buildArtworkGenerationRequests({
      run: {
        ...run,
        artworkGenerationStatus: "failed",
        artworkGenerationError: "Artwork generation was interrupted.",
        creativeMix: [
          { id: "mix-static", service: "single-static", quantity: 2 }
        ],
        quantity: 2,
        directions: run.directions.map((direction) => ({
          ...direction,
          service: "single-static" as const,
          selected: true
        })),
        outputs: [
          {
            id: "hook-1-v1",
            directionId: "hook-1",
            format: "1:1 Static",
            status: "draft",
            clientStatus: "queued",
            assetUrl: "https://example.com/hook-1.png",
            revisionCount: 0,
            approval: {
              graphicDesign: null,
              clientService: null,
              projectManager: null
            },
            approvalComments: {
              graphicDesign: "",
              clientService: "",
              projectManager: ""
            }
          }
        ]
      }
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.selectedHooks.map((hook) => hook.id)).toEqual([
      "hook-2"
    ]);
    expect(requests[0]?.assetVersion).toBe(1);
  });

  it("creates a new asset version when the user intentionally generates again", () => {
    const source = run.directions[0];
    if (!source) throw new Error("Expected a direction fixture.");
    const requests = buildArtworkGenerationRequests({
      run: {
        ...run,
        artworkGenerationStatus: "idle",
        artworkGenerationError: null,
        creativeMix: [
          { id: "mix-static", service: "single-static", quantity: 1 }
        ],
        quantity: 1,
        directions: [{ ...source, selected: true }],
        outputs: [
          {
            id: "hook-1-v1",
            directionId: "hook-1",
            format: "1:1 Static",
            status: "ready",
            clientStatus: "queued",
            assetUrl: "https://example.com/hook-1-v1.png",
            revisionCount: 0,
            approval: {
              graphicDesign: null,
              clientService: null,
              projectManager: null
            },
            approvalComments: {
              graphicDesign: "",
              clientService: "",
              projectManager: ""
            }
          }
        ]
      }
    });

    expect(requests[0]?.selectedHooks.map((hook) => hook.id)).toEqual([
      "hook-1"
    ]);
    expect(requests[0]?.assetVersion).toBe(2);
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
              description: "Old extracted logo",
              assetUrl: "https://assets.example.com/old-logo.png"
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
          url: "https://assets.example.com/latest-uploaded-logo.png",
          label: "Primary reference · Logo · Latest uploaded logo"
        },
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

    expect(n8nRequest.logoUrl).toBe(
      "https://assets.example.com/latest-uploaded-logo.png"
    );
    expect(n8nRequest.referenceImageUrls).toEqual([
      {
        url: "https://assets.example.com/reference.png",
        label: "Reference mood"
      }
    ]);
    expect(n8nRequest.selectedHooks).toEqual(request.selectedHooks);
    expect(n8nRequest.brandMemory).toEqual(request.brandMemory);
  });
});
