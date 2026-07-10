import { describe, expect, it } from "vitest";
import { brands } from "../../data/mock-brands";
import {
  createInitialWorkspaceState,
  getActiveRun,
  workspaceReducer
} from "./workspace-reducer";
import type { WorkspaceState, WorkflowAction } from "./model";
import { buildDirectionFixtures } from "./test-fixtures";

const now = "2026-06-23T10:00:00.000Z";

function update(
  state: WorkspaceState,
  action: WorkflowAction,
  updatedAt = now
): WorkspaceState {
  return workspaceReducer(state, {
    type: "apply-run-action",
    runId: getActiveRun(state).id,
    action,
    now: updatedAt
  });
}

describe("workspaceReducer", () => {
  it("applies an async action to the run it was started against, even after the user switched to a different run", () => {
    const brand = brands[0];
    if (!brand) throw new Error("Mock brand fixture is missing.");

    let workspace = createInitialWorkspaceState({ runId: "run-a", now });
    workspace = update(workspace, { type: "select-brand", brand });

    // Simulate a hook-generation request kicked off while "run-a" is
    // active: the async caller captured "run-a" as the target.
    const runAId = getActiveRun(workspace).id;

    // The user switches to a different run before the request resolves —
    // this used to be exactly how "regenerate" results got misapplied or
    // silently dropped.
    workspace = workspaceReducer(workspace, {
      type: "create-run",
      id: "run-b",
      now,
      keepBrand: false
    });
    expect(workspace.activeRunId).toBe("run-b");

    // The async request now resolves. It must still land on "run-a", not
    // on whichever run happens to be active at this point.
    workspace = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: runAId,
      action: {
        type: "generate-directions",
        directions: buildDirectionFixtures(brand.name)
      },
      now
    });

    expect(workspace.runsById["run-a"]?.directions).toHaveLength(6);
    expect(workspace.runsById["run-b"]?.directions).toEqual([]);
    // Switching away and the async result landing elsewhere must not move
    // the user's current view out from under them.
    expect(workspace.activeRunId).toBe("run-b");
  });

  it("drops an async action harmlessly if its target run was closed before it resolved", () => {
    const workspace = createInitialWorkspaceState({ runId: "run-a", now });
    const closedRunResult = workspaceReducer(workspace, {
      type: "apply-run-action",
      runId: "run-that-never-existed",
      action: { type: "auto-select-directions" },
      now
    });

    expect(closedRunResult).toEqual(workspace);
  });

  it("isolates data between parallel runs", () => {
    const brand = brands[0];
    if (!brand) throw new Error("Mock brand fixture is missing.");

    let workspace = createInitialWorkspaceState({
      runId: "single-run",
      now
    });
    workspace = update(workspace, { type: "select-brand", brand });
    workspace = update(workspace, {
      type: "set-brief",
      brief: "Single static brief"
    });

    workspace = workspaceReducer(workspace, {
      type: "create-run",
      id: "album-run",
      now: "2026-06-23T10:05:00.000Z",
      keepBrand: true
    });
    workspace = update(workspace, {
      type: "set-service",
      service: "album-post"
    });
    workspace = update(workspace, {
      type: "set-brief",
      brief: "Album brief"
    });

    expect(getActiveRun(workspace).id).toBe("album-run");
    expect(getActiveRun(workspace).brief).toBe("Album brief");
    expect(getActiveRun(workspace).service).toBe("album-post");

    workspace = workspaceReducer(workspace, {
      type: "switch-run",
      id: "single-run"
    });

    expect(getActiveRun(workspace).brief).toBe("Single static brief");
    expect(getActiveRun(workspace).service).toBe("single-static");
    expect(workspace.runsById["album-run"]?.brief).toBe("Album brief");
  });

  it("creates a blank run from refresh behavior", () => {
    const brand = brands[0];
    if (!brand) throw new Error("Mock brand fixture is missing.");

    let workspace = createInitialWorkspaceState({ runId: "run-1", now });
    workspace = update(workspace, { type: "select-brand", brand });
    workspace = workspaceReducer(workspace, {
      type: "create-run",
      id: "run-2",
      now,
      keepBrand: false
    });

    expect(getActiveRun(workspace).brand).toBeNull();
    expect(workspace.runsById["run-1"]?.brand?.id).toBe(brand.id);
  });

  it("closes an active run without deleting remaining runs", () => {
    let workspace = createInitialWorkspaceState({ runId: "run-1", now });
    workspace = workspaceReducer(workspace, {
      type: "create-run",
      id: "run-2",
      now,
      keepBrand: false
    });
    workspace = workspaceReducer(workspace, {
      type: "close-run",
      id: "run-2"
    });

    expect(workspace.activeRunId).toBe("run-1");
    expect(workspace.runOrder).toEqual(["run-1"]);
    expect(workspace.runsById["run-2"]).toBeUndefined();
  });

  it("does not close the final remaining run", () => {
    const workspace = createInitialWorkspaceState({ runId: "run-1", now });
    const result = workspaceReducer(workspace, {
      type: "close-run",
      id: "run-1"
    });

    expect(result.runOrder).toEqual(["run-1"]);
    expect(result.toast).toBe("This is your only run");
  });

  it("blocks workflow actions that skip required steps", () => {
    const workspace = createInitialWorkspaceState({ runId: "run-1", now });
    const result = update(workspace, {
      type: "generate-directions",
      directions: []
    });

    expect(getActiveRun(result).directions).toEqual([]);
    expect(getActiveRun(result).updatedAt).toBe(getActiveRun(workspace).updatedAt);
    expect(result.toast).toBe("Choose a brand first.");
  });

  it("blocks selecting clients that have no brand memory", () => {
    const workspace = createInitialWorkspaceState({ runId: "run-1", now });
    const result = update(workspace, {
      type: "select-brand",
      brand: {
        id: "mapping:new-client",
        name: "New Client",
        category: "No brand memory yet",
        initials: "NC",
        library: { brand: [], products: [], docs: [], refs: [] },
        memory: { working: [], avoid: [] },
        existsInSystem: false,
        source: "mapping"
      }
    });

    expect(getActiveRun(result).brand).toBeNull();
    expect(result.toast).toBe("This client has no Moons brand memory yet.");
  });

  it("prevents internal review before QA completes", () => {
    const brand = brands[0];
    if (!brand) throw new Error("Mock brand fixture is missing.");

    let workspace = createInitialWorkspaceState({ runId: "run-1", now });
    workspace = update(workspace, { type: "select-brand", brand });
    workspace = update(workspace, {
      type: "generate-directions",
      directions: buildDirectionFixtures(brand.name)
    });
    workspace = update(workspace, { type: "auto-select-directions" });
    workspace = update(workspace, { type: "create-outputs" });

    const result = update(workspace, { type: "approve-all" });

    expect(getActiveRun(result).approved).toBe(false);
    expect(result.toast).toBe("Run QA before internal approval.");
  });

  it("allows the guarded happy path through delivery", () => {
    const brand = brands[0];
    if (!brand) throw new Error("Mock brand fixture is missing.");

    let workspace = createInitialWorkspaceState({ runId: "run-1", now });
    workspace = update(workspace, { type: "select-brand", brand });
    workspace = update(workspace, { type: "set-stage", stage: "brief" });
    workspace = update(workspace, {
      type: "generate-directions",
      directions: buildDirectionFixtures(brand.name)
    });
    workspace = update(workspace, { type: "auto-select-directions" });
    workspace = update(workspace, { type: "create-outputs" });
    workspace = update(workspace, {
      type: "run-qa",
      results: getActiveRun(workspace).outputs.map((output) => ({
        outputId: output.id,
        passed: true,
        reason: "Looks good."
      }))
    });
    workspace = update(workspace, { type: "set-stage", stage: "approval" });
    workspace = update(workspace, { type: "approve-all" });
    workspace = update(workspace, { type: "set-stage", stage: "client" });
    workspace = update(workspace, { type: "send-client" });

    for (const output of getActiveRun(workspace).outputs) {
      workspace = update(workspace, {
        type: "approve-output",
        id: output.id
      });
    }

    workspace = update(workspace, { type: "mark-delivered" });
    workspace = update(workspace, { type: "mark-done" });

    expect(getActiveRun(workspace).stage).toBe("summary");
    expect(getActiveRun(workspace).done).toBe(true);
  });
});
