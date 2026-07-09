import { describe, expect, it } from "vitest";
import { brands } from "../../data/mock-brands";
import {
  createInitialWorkspaceState,
  workspaceReducer
} from "../../features/workflow/workspace-reducer";
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
      type: "update-active-run",
      now: "2026-06-23T10:01:00.000Z",
      action: { type: "select-brand", brand }
    });
    workspace = workspaceReducer(workspace, {
      type: "update-active-run",
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
      type: "update-active-run",
      now: "2026-06-23T10:04:00.000Z",
      action: { type: "set-service", service: "album-post" }
    });
    workspace = workspaceReducer(workspace, {
      type: "update-active-run",
      now: "2026-06-23T10:05:00.000Z",
      action: { type: "set-brief", brief: "Album persisted brief" }
    });

    const restored = deserializeWorkspace(
      serializeWorkspace(workspace, "2026-06-23T10:06:00.000Z")
    );

    expect(restored?.activeRunId).toBe("album-run");
    expect(restored?.runOrder).toEqual(["single-run", "album-run"]);
    expect(restored?.runsById["album-run"]?.brief).toBe(
      "Album persisted brief"
    );
    expect(restored?.runsById["single-run"]?.brand?.id).toBe(brand.id);
    expect(restored?.runsById["single-run"]?.brandMenuOpen).toBe(false);
    expect(restored?.toast).toBeNull();
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
