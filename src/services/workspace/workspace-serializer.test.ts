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
      now: "2026-06-23T10:04:30.000Z",
      action: { type: "add-creative-mix-item" }
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
      action: { type: "set-artwork-mode", mode: "design-system" }
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
      action: { type: "set-output-size", size: "2048x1152" }
    });
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: workspace.activeRunId,
      now: "2026-06-23T10:05:50.000Z",
      action: { type: "set-success-metric", metric: "ROAS" }
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
      "design-system"
    );
    expect(restored?.runsById["album-run"]?.imagePromptModel).toBe(
      "anthropic/claude-sonnet-4.6"
    );
    expect(restored?.runsById["album-run"]?.outputSize).toBe("2048x1152");
    expect(restored?.runsById["album-run"]?.successMetric).toBe("ROAS");
    expect(restored?.runsById["album-run"]?.creativeMix).toEqual([
      { id: "creative-mix-1", service: "album-post", quantity: 3 },
      expect.objectContaining({ service: "single-static", quantity: 1 })
    ]);
    expect(restored?.runsById["album-run"]?.quantity).toBe(4);
    expect(restored?.runsById["single-run"]?.brand?.id).toBe(brand.id);
    expect(restored?.runsById["single-run"]?.brandMenuOpen).toBe(false);
    expect(restored?.toast).toBeNull();
  });

  it("loads older snapshots without an artwork mode as standard", () => {
    const workspace = createInitialWorkspaceState({
      runId: "run-1",
      now: "2026-06-23T10:00:00.000Z"
    });
    const parsed = JSON.parse(
      serializeWorkspace(workspace, "2026-06-23T10:01:00.000Z")
    ) as { data: { runsById: Record<string, { artworkMode?: string }> } };
    delete parsed.data.runsById["run-1"]?.artworkMode;

    const restored = deserializeWorkspace(JSON.stringify(parsed));

    expect(restored?.runsById["run-1"]?.artworkMode).toBe("standard");
  });

  it("loads older snapshots without a success metric as CTR", () => {
    const workspace = createInitialWorkspaceState({
      runId: "run-1",
      now: "2026-06-23T10:00:00.000Z"
    });
    const parsed = JSON.parse(
      serializeWorkspace(workspace, "2026-06-23T10:01:00.000Z")
    ) as { data: { runsById: Record<string, { successMetric?: string }> } };
    delete parsed.data.runsById["run-1"]?.successMetric;

    const restored = deserializeWorkspace(JSON.stringify(parsed));

    expect(restored?.runsById["run-1"]?.successMetric).toBe("CTR");
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
      { id: "creative-mix-1", service: "single-static", quantity: 3 }
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
