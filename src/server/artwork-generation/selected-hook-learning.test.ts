import { describe, expect, it } from "vitest";
import type {
  ArtworkGenerationRequest,
  ArtworkGenerationResponse
} from "../../services/artwork-generation/openai-image-generation";
import {
  buildSelectedHookLearningCandidates,
  isSelectedHookLearningCaptureEnabled
} from "./selected-hook-learning";

const input: ArtworkGenerationRequest = {
  model: "gpt-image-2",
  artworkMode: "design-system",
  imagePromptModel: "gpt-5.6-terra",
  runId: "run-korea-king-1",
  brand: {
    id: "korea-king",
    name: "Korea King",
    category: "Cookware",
    personality: ["premium"],
    colors: ["#001D4F"]
  },
  service: "single-static",
  quantity: 1,
  brief: "Sell the cookware collection.",
  selectedHooks: [
    {
      id: "hook-1",
      hook: "Heat that reaches every edge",
      concept: "Make even heat visible.",
      why: "Turns the product feature into proof.",
      visual: "Gold pan with a heat map.",
      cta: "Shop now",
      supportingPoints: ["Even heat"],
      formatBeats: [],
      caption: "Cook with confidence."
    }
  ],
  textInputs: [],
  referenceImages: [],
  brandMemory: { working: [], avoid: [] },
  brandLibrary: { brand: [], products: [], docs: [], refs: [] },
  output: { size: "1024x1024", format: "png" }
};

const outputs: ArtworkGenerationResponse["outputs"] = [
  {
    id: "hook-1-v1",
    directionId: "hook-1",
    format: "1:1 Static",
    status: "ready",
    clientStatus: "queued",
    assetUrl: "https://example.supabase.co/signed/korea-king/hook-1-v1.png",
    assetBucket: "creative-assets",
    assetStoragePath: "korea-king/run-korea-king-1/outputs/hook-1-v1.png",
    provider: "openai",
    model: "gpt-image-2",
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
];

describe("selected hook learning capture", () => {
  it("is disabled by default and only enables for an explicit true value", () => {
    expect(isSelectedHookLearningCaptureEnabled(undefined)).toBe(false);
    expect(isSelectedHookLearningCaptureEnabled("false")).toBe(false);
    expect(isSelectedHookLearningCaptureEnabled(" TRUE ")).toBe(true);
  });

  it("builds brand-scoped candidates with a renewable storage location", () => {
    const candidates = buildSelectedHookLearningCandidates({
      input,
      outputs,
      generatedAt: "2026-07-19T10:00:00.000Z"
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        client_id: "korea-king",
        workspace_run_id: "run-korea-king-1",
        direction_id: "hook-1",
        output_id: "hook-1-v1",
        hook_text: "Heat that reaches every edge",
        image_url:
          "https://example.supabase.co/signed/korea-king/hook-1-v1.png",
        asset_bucket: "creative-assets",
        asset_storage_path:
          "korea-king/run-korea-king-1/outputs/hook-1-v1.png",
        generated_at: "2026-07-19T10:00:00.000Z"
      })
    ]);
  });

  it("does not create a learning candidate without a real brand", () => {
    expect(
      buildSelectedHookLearningCandidates({
        input: { ...input, brand: null },
        outputs
      })
    ).toEqual([]);
  });
});
