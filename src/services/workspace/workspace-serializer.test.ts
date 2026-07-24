import { describe, expect, it } from "vitest";
import { brands } from "../../data/mock-brands";
import {
  createInitialWorkspaceState,
  workspaceReducer
} from "../../features/workflow/workspace-reducer";
import { buildDirectionFixtures } from "../../features/workflow/test-fixtures";
import {
  deserializeWorkspace,
  serializeWorkspace,
  WORKSPACE_SCHEMA_VERSION
} from "./workspace-serializer";

describe("workspace serializer", () => {
  it("preserves onboarding questionnaire context with the selected brand", () => {
    const brand = brands[0];
    if (!brand) throw new Error("Mock brand fixture is missing.");
    let workspace = createInitialWorkspaceState({
      runId: "questionnaire-run",
      now: "2026-07-22T10:00:00.000Z"
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: workspace.activeRunId,
      now: "2026-07-22T10:01:00.000Z",
      action: {
        type: "select-brand",
        brand: {
          ...brand,
          onboardingQuestionnaire: {
            sourceUrl: "https://example.com/onboarding",
            text: "Onboarding answer about the brand audience.",
            preview: "Onboarding answer about the brand audience.",
            facebookUrls: ["https://facebook.com/example"]
          }
        }
      }
    });

    const restored = deserializeWorkspace(
      serializeWorkspace(workspace, "2026-07-22T10:02:00.000Z")
    );

    expect(
      restored?.runsById["questionnaire-run"]?.brand?.onboardingQuestionnaire
    ).toMatchObject({
      text: "Onboarding answer about the brand audience.",
      facebookUrls: ["https://facebook.com/example"]
    });
  });

  it("round-trips high-volume mixes with up to 50 items per content type", () => {
    let workspace = createInitialWorkspaceState({
      runId: "high-volume-run",
      now: "2026-07-21T12:00:00.000Z"
    });
    for (const id of ["creative-mix-1", "creative-mix-2", "creative-mix-3"]) {
      workspace = workspaceReducer(workspace, {
        type: "apply-run-action",
        runId: workspace.activeRunId,
        now: "2026-07-21T12:01:00.000Z",
        action: { type: "set-creative-mix-quantity", id, quantity: 50 }
      });
    }

    const restored = deserializeWorkspace(
      serializeWorkspace(workspace, "2026-07-21T12:02:00.000Z")
    );
    const run = restored?.runsById[restored.activeRunId];

    expect(run?.creativeMix?.map((item) => item.quantity)).toEqual([50, 50, 50]);
    expect(run?.quantity).toBe(150);
  });

  it("preserves reference role and primary selection", () => {
    let workspace = createInitialWorkspaceState({
      runId: "reference-run",
      now: "2026-07-20T12:00:00.000Z"
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: workspace.activeRunId,
      now: "2026-07-20T12:01:00.000Z",
      action: {
        type: "toggle-reference-image",
        item: {
          id: "reference-product",
          url: "https://example.com/product.png",
          label: "Product packshot",
          role: "product",
          primary: true
        }
      }
    });

    const restored = deserializeWorkspace(
      serializeWorkspace(workspace, "2026-07-20T12:02:00.000Z")
    );
    expect(restored?.runsById[restored.activeRunId]?.referenceImages).toEqual([
      {
        id: "reference-product",
        url: "https://example.com/product.png",
        label: "Product packshot",
        role: "product",
        primary: true
      }
    ]);
  });

  it("preserves explicit Product truth selections", () => {
    const brand = brands[0];
    const selectedProduct = brand?.library.products[1];
    if (!brand || !selectedProduct) {
      throw new Error("Mock brand product fixture is missing.");
    }

    let workspace = createInitialWorkspaceState({
      runId: "product-context-run",
      now: "2026-07-20T12:00:00.000Z"
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: workspace.activeRunId,
      now: "2026-07-20T12:01:00.000Z",
      action: { type: "select-brand", brand }
    });
    for (const product of brand.library.products) {
      if (product.id === selectedProduct.id) continue;
      workspace = workspaceReducer(workspace, {
        type: "apply-run-action",
        runId: workspace.activeRunId,
        now: "2026-07-20T12:02:00.000Z",
        action: { type: "toggle-product-context", id: product.id }
      });
    }

    const restored = deserializeWorkspace(
      serializeWorkspace(workspace, "2026-07-20T12:03:00.000Z")
    );
    expect(
      restored?.runsById[restored.activeRunId]?.selectedProductIds
    ).toEqual([selectedProduct.id]);
  });

  it("round-trips parallel run data and removes transient UI state", () => {
    const brand = brands[0];
    if (!brand) throw new Error("Mock brand fixture is missing.");

    let workspace = createInitialWorkspaceState({
      runId: "single-run",
      now: "2026-06-23T10:00:00.000Z"
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: workspace.activeRunId,
      now: "2026-06-23T10:01:00.000Z",
      action: { type: "select-brand", brand }
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: workspace.activeRunId,
      now: "2026-06-23T10:02:00.000Z",
      action: { type: "toggle-brand-menu" }
    });
    workspace = workspaceReducer(workspace, {
      type: "create-run",
      id: "album-run",
      now: "2026-06-23T10:03:00.000Z",
      keepBrand: true
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: workspace.activeRunId,
      now: "2026-06-23T10:04:00.000Z",
      action: { type: "set-service", service: "album-post" }
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: workspace.activeRunId,
      now: "2026-06-23T10:05:00.000Z",
      action: { type: "set-brief", brief: "Album persisted brief" }
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: workspace.activeRunId,
      now: "2026-06-23T10:05:30.000Z",
      action: { type: "set-hook-idea-mode", mode: "fresh-research" }
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: workspace.activeRunId,
      now: "2026-06-23T10:05:35.000Z",
      action: { type: "set-artwork-mode", mode: "reference-library" }
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: workspace.activeRunId,
      now: "2026-06-23T10:05:45.000Z",
      action: {
        type: "set-image-prompt-model",
        model: "anthropic/claude-sonnet-4.6"
      }
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: workspace.activeRunId,
      now: "2026-06-23T10:05:47.000Z",
      action: { type: "set-album-format", format: "four-grid" }
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: workspace.activeRunId,
      now: "2026-06-23T10:05:48.000Z",
      action: { type: "set-output-size", size: "2048x1152" }
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: workspace.activeRunId,
      now: "2026-06-23T10:05:50.000Z",
      action: { type: "set-success-metric", metric: "ROAS" }
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: workspace.activeRunId,
      now: "2026-06-23T10:05:55.000Z",
      action: {
        type: "add-uploaded-materials",
        items: [
          {
            id: "material-1",
            name: "product.png",
            mediaType: "image/png",
            role: "product",
            description: "Use the real pack shot",
            url: "https://example.com/product.png",
            storagePath: "brand/creative-materials/product.png",
            storageBucket: "brand-assets"
          }
        ]
      }
    });

    const restored = deserializeWorkspace(
      serializeWorkspace(workspace, "2026-06-23T10:06:00.000Z")
    );

    expect(restored?.activeRunId).toBe("album-run");
    expect(restored?.runOrder).toEqual(["single-run", "album-run"]);
    expect(restored?.runsById["album-run"]?.brief).toBe(
      "Album persisted brief"
    );
    expect(restored?.runsById["album-run"]?.artworkMode).toBe(
      "reference-library"
    );
    expect(restored?.runsById["album-run"]?.hookIdeaMode).toBe(
      "standard"
    );
    expect(restored?.runsById["album-run"]?.imagePromptModel).toBe(
      "anthropic/claude-sonnet-4.6"
    );
    expect(restored?.runsById["album-run"]?.albumFormat).toBe(
      "four-grid"
    );
    expect(restored?.runsById["album-run"]?.outputSize).toBe("2048x1152");
    expect(restored?.runsById["album-run"]?.successMetric).toBe("ROAS");
    expect(restored?.runsById["album-run"]?.uploadedMaterials[0]).toMatchObject({
      name: "product.png",
      role: "product",
      description: "Use the real pack shot"
    });
    expect(restored?.runsById["album-run"]?.creativeMix).toEqual([
      { id: "creative-mix-1", service: "album-post", quantity: 3 }
    ]);
    expect(restored?.runsById["album-run"]?.quantity).toBe(3);
    expect(restored?.runsById["single-run"]?.brand?.id).toBe(brand.id);
    expect(restored?.runsById["single-run"]?.brandMenuOpen).toBe(false);
    expect(restored?.toast).toBeNull();
  });

  it("loads older snapshots without an artwork mode as Design System", () => {
    const workspace = createInitialWorkspaceState({
      runId: "run-1",
      now: "2026-06-23T10:00:00.000Z"
    });
    const parsed = JSON.parse(
      serializeWorkspace(workspace, "2026-06-23T10:01:00.000Z")
    ) as { data: { runsById: Record<string, { artworkMode?: string }> } };
    delete parsed.data.runsById["run-1"]?.artworkMode;

    const restored = deserializeWorkspace(JSON.stringify(parsed));

    expect(restored?.runsById["run-1"]?.artworkMode).toBe("design-system");
  });

  it("restores an interrupted generation as retryable after refresh", () => {
    let workspace = createInitialWorkspaceState({
      runId: "run-1",
      now: "2026-07-16T08:00:00.000Z"
    });
    const brand = brands[0];
    if (!brand) throw new Error("Mock brand fixture is missing.");
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: "run-1",
      now: "2026-07-16T08:00:30.000Z",
      action: { type: "select-brand", brand }
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: "run-1",
      now: "2026-07-16T08:01:00.000Z",
      action: { type: "start-idea-generation" }
    });

    const restored = deserializeWorkspace(
      serializeWorkspace(workspace, "2026-07-16T08:01:01.000Z")
    );

    expect(restored?.runsById["run-1"]?.ideaGenerationStatus).toBe("failed");
    expect(restored?.runsById["run-1"]?.ideaGenerationError).toBe(
      "Idea generation was interrupted by refresh. Generate again."
    );
  });

  it("loads older snapshots without generation state as idle", () => {
    const workspace = createInitialWorkspaceState({
      runId: "run-1",
      now: "2026-07-16T08:00:00.000Z"
    });
    const parsed = JSON.parse(
      serializeWorkspace(workspace, "2026-07-16T08:01:00.000Z")
    ) as {
      data: {
        runsById: Record<
          string,
          {
            ideaGenerationStatus?: string;
            ideaGenerationError?: string | null;
          }
        >;
      };
    };
    delete parsed.data.runsById["run-1"]?.ideaGenerationStatus;
    delete parsed.data.runsById["run-1"]?.ideaGenerationError;

    const restored = deserializeWorkspace(JSON.stringify(parsed));

    expect(restored?.runsById["run-1"]?.ideaGenerationStatus).toBe("idle");
    expect(restored?.runsById["run-1"]?.ideaGenerationError).toBeNull();
  });

  it("restores interrupted artwork generation as retryable after refresh", () => {
    const initialWorkspace = createInitialWorkspaceState({
      runId: "run-1",
      now: "2026-07-16T08:00:00.000Z"
    });
    const run = initialWorkspace.runsById["run-1"]!;
    const workspace = {
      ...initialWorkspace,
      runsById: {
        ...initialWorkspace.runsById,
        "run-1": {
          ...run,
          artworkGenerationStatus: "running" as const
        }
      }
    };

    const restored = deserializeWorkspace(
      serializeWorkspace(workspace, "2026-07-16T08:01:01.000Z")
    );

    expect(restored?.runsById["run-1"]?.artworkGenerationStatus).toBe(
      "failed"
    );
    expect(restored?.runsById["run-1"]?.artworkGenerationError).toBe(
      "Artwork generation was interrupted by refresh. Generate again."
    );
  });

  it("loads older snapshots without artwork generation state as idle", () => {
    const workspace = createInitialWorkspaceState({
      runId: "run-1",
      now: "2026-07-16T08:00:00.000Z"
    });
    const parsed = JSON.parse(
      serializeWorkspace(workspace, "2026-07-16T08:01:00.000Z")
    ) as {
      data: {
        runsById: Record<
          string,
          {
            artworkGenerationStatus?: string;
            artworkGenerationError?: string | null;
          }
        >;
      };
    };
    delete parsed.data.runsById["run-1"]?.artworkGenerationStatus;
    delete parsed.data.runsById["run-1"]?.artworkGenerationError;

    const restored = deserializeWorkspace(JSON.stringify(parsed));

    expect(restored?.runsById["run-1"]?.artworkGenerationStatus).toBe("idle");
    expect(restored?.runsById["run-1"]?.artworkGenerationError).toBeNull();
  });

  it("round-trips supporting details and verified CTA metadata", () => {
    const brand = brands[0];
    if (!brand) throw new Error("Mock brand fixture is missing.");
    let workspace = createInitialWorkspaceState({
      runId: "run-details",
      now: "2026-07-15T10:00:00.000Z"
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: workspace.activeRunId,
      now: "2026-07-15T10:00:20.000Z",
      action: { type: "select-brand", brand }
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: workspace.activeRunId,
      now: "2026-07-15T10:00:40.000Z",
      action: { type: "set-brief", brief: "Generate qualified lead creative" }
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: workspace.activeRunId,
      now: "2026-07-15T10:01:00.000Z",
      action: {
        type: "generate-directions",
        directions: [
          {
            id: "direction-details",
            service: "single-static",
            hook: "ฟอร์มเยอะ ไม่ได้แปลว่าได้ลูกค้ามากขึ้น",
            subheadline: "โฟกัส Lead ที่มีโอกาสปิดการขายจริง",
            concept: "เปรียบเทียบจำนวนฟอร์มกับคุณภาพ Lead",
            why: "ทำให้ปัญหาของเจ้าของธุรกิจชัดเจน",
            visual: "แสดงกระบวนการคัดกรองอย่างเรียบง่าย",
            cta: "ปรึกษาทีม Convert Cake",
            supportingPoints: ["วิเคราะห์ตั้งแต่ Targeting ถึง Funnel"],
            ctaActionType: "inbox",
            ctaDestination: "Facebook Inbox",
            contactLine: "Inbox เพื่อปรึกษาทีม Convert Cake",
            caption: "ฟอร์มเยอะอาจไม่ได้แปลว่า Lead มีคุณภาพ",
            selected: false
          }
        ]
      }
    });

    const restored = deserializeWorkspace(
      serializeWorkspace(workspace, "2026-07-15T10:02:00.000Z")
    );

    expect(restored?.runsById["run-details"]?.directions[0]).toMatchObject({
      supportingPoints: ["วิเคราะห์ตั้งแต่ Targeting ถึง Funnel"],
      ctaActionType: "inbox",
      ctaDestination: "Facebook Inbox",
      contactLine: "Inbox เพื่อปรึกษาทีม Convert Cake"
    });
  });

  it("loads older snapshots without a success metric as CVR", () => {
    const workspace = createInitialWorkspaceState({
      runId: "run-1",
      now: "2026-06-23T10:00:00.000Z"
    });
    const parsed = JSON.parse(
      serializeWorkspace(workspace, "2026-06-23T10:01:00.000Z")
    ) as { data: { runsById: Record<string, { successMetric?: string }> } };
    delete parsed.data.runsById["run-1"]?.successMetric;

    const restored = deserializeWorkspace(JSON.stringify(parsed));

    expect(restored?.runsById["run-1"]?.successMetric).toBe("CVR");
  });

  it("loads older snapshots without an image prompt model as GPT 5.6", () => {
    const workspace = createInitialWorkspaceState({
      runId: "run-1",
      now: "2026-06-23T10:00:00.000Z"
    });
    const parsed = JSON.parse(
      serializeWorkspace(workspace, "2026-06-23T10:01:00.000Z")
    ) as {
      data: { runsById: Record<string, { imagePromptModel?: string }> };
    };
    delete parsed.data.runsById["run-1"]?.imagePromptModel;

    const restored = deserializeWorkspace(JSON.stringify(parsed));

    expect(restored?.runsById["run-1"]?.imagePromptModel).toBe(
      "gpt-5.6-terra"
    );
  });

  it("loads older snapshots without an output size as 1024x1024", () => {
    const workspace = createInitialWorkspaceState({
      runId: "run-1",
      now: "2026-06-23T10:00:00.000Z"
    });
    const parsed = JSON.parse(
      serializeWorkspace(workspace, "2026-06-23T10:01:00.000Z")
    ) as {
      data: { runsById: Record<string, { outputSize?: string }> };
    };
    delete parsed.data.runsById["run-1"]?.outputSize;

    const restored = deserializeWorkspace(JSON.stringify(parsed));

    expect(restored?.runsById["run-1"]?.outputSize).toBe("1024x1024");
  });

  it("migrates older single-format snapshots into one creative-mix row", () => {
    const workspace = createInitialWorkspaceState({
      runId: "run-1",
      now: "2026-06-23T10:00:00.000Z"
    });
    const parsed = JSON.parse(
      serializeWorkspace(workspace, "2026-06-23T10:01:00.000Z")
    ) as { data: { runsById: Record<string, { creativeMix?: unknown }> } };
    delete parsed.data.runsById["run-1"]?.creativeMix;

    const restored = deserializeWorkspace(JSON.stringify(parsed));

    expect(restored?.runsById["run-1"]?.creativeMix).toEqual([
      { id: "creative-mix-1", service: "single-static", quantity: 6 }
    ]);
  });

  it("round-trips per-creative approval state on outputs", () => {
    const brand = brands[0];
    if (!brand) throw new Error("Mock brand fixture is missing.");

    let workspace = createInitialWorkspaceState({
      runId: "run-1",
      now: "2026-06-23T10:00:00.000Z"
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: workspace.activeRunId,
      now: "2026-06-23T10:01:00.000Z",
      action: { type: "select-brand", brand }
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: workspace.activeRunId,
      now: "2026-06-23T10:02:00.000Z",
      action: {
        type: "generate-directions",
        directions: buildDirectionFixtures(brand.name)
      }
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: workspace.activeRunId,
      now: "2026-06-23T10:02:30.000Z",
      action: { type: "auto-select-directions" }
    });
    const firstDirectionId = workspace.runsById[workspace.activeRunId]
      ?.directions[0]?.id;
    if (!firstDirectionId) throw new Error("Expected a generated direction.");
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: workspace.activeRunId,
      now: "2026-06-23T10:02:35.000Z",
      action: {
        type: "set-direction-export-group",
        id: firstDirectionId,
        group: "recommended"
      }
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: workspace.activeRunId,
      now: "2026-06-23T10:02:45.000Z",
      action: { type: "create-outputs" }
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: workspace.activeRunId,
      now: "2026-06-23T10:02:50.000Z",
      action: {
        type: "run-qa",
        results: workspace.runsById[workspace.activeRunId]?.outputs.map(
          (output) => ({
            outputId: output.id,
            passed: true,
            reason: "Looks good."
          })
        ) ?? []
      }
    });

    const run = workspace.runsById["run-1"];
    const [firstOutput] = run?.outputs ?? [];
    if (!firstOutput) throw new Error("Expected at least one mock output.");

    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: workspace.activeRunId,
      now: "2026-06-23T10:03:00.000Z",
      action: {
        type: "review-output",
        id: firstOutput.id,
        role: "graphicDesign",
        decision: "rejected",
        comment: "Please revise the hierarchy."
      }
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: workspace.activeRunId,
      now: "2026-06-23T10:03:10.000Z",
      action: {
        type: "save-output-reference",
        id: firstOutput.id
      }
    });

    const restored = deserializeWorkspace(
      serializeWorkspace(workspace, "2026-06-23T10:04:00.000Z")
    );
    const restoredOutput = restored?.runsById["run-1"]?.outputs.find(
      (output) => output.id === firstOutput.id
    );

    expect(restoredOutput?.approval).toEqual({
      graphicDesign: "rejected",
      clientService: null,
      projectManager: null
    });
    expect(restoredOutput?.approvalComments.graphicDesign).toBe(
      "Please revise the hierarchy."
    );
    expect(restoredOutput?.status).toBe("needs-revision");
    expect(restoredOutput?.savedToReferences).toBe(true);
    expect(restored?.runsById["run-1"]?.directions[0]).toMatchObject({
      service: "single-static",
      subheadline: "Subheadline 1",
      subheadlineHighlight: "Subheadline 1",
      exportGroup: "recommended"
    });
  });

  it("rejects malformed JSON and unknown schema versions", () => {
    expect(deserializeWorkspace("{not json")).toBeNull();
    expect(
      deserializeWorkspace(
        JSON.stringify({
          schemaVersion: WORKSPACE_SCHEMA_VERSION + 1,
          savedAt: "2026-06-23T10:00:00.000Z",
          data: {}
        })
      )
    ).toBeNull();
  });

  it("rejects snapshots whose active run does not exist", () => {
    const workspace = createInitialWorkspaceState({
      runId: "run-1",
      now: "2026-06-23T10:00:00.000Z"
    });
    const parsed = JSON.parse(
      serializeWorkspace(workspace, "2026-06-23T10:01:00.000Z")
    ) as { data: { activeRunId: string } };
    parsed.data.activeRunId = "missing-run";

    expect(deserializeWorkspace(JSON.stringify(parsed))).toBeNull();
  });
});
