import { describe, expect, it } from "vitest";
import { brands } from "../../data/mock-brands";
import {
  initialWorkflowState,
  workflowReducer
} from "./reducer";
import { buildDirectionFixtures } from "./test-fixtures";
import type { WorkflowState } from "./model";

function passingQaResults(state: WorkflowState) {
  return state.outputs.map((output) => ({
    outputId: output.id,
    passed: true,
    reason: "Looks good."
  }));
}

describe("workflowReducer", () => {
  it("moves from brand selection to generated directions", () => {
    const brand = brands[0];
    if (!brand) throw new Error("Mock brand fixture is missing.");

    const selected = workflowReducer(initialWorkflowState, {
      type: "select-brand",
      brand
    });
    const generated = workflowReducer(selected, {
      type: "generate-directions",
      directions: buildDirectionFixtures(brand.name)
    });

    expect(generated.stage).toBe("directions");
    expect(generated.directions).toHaveLength(6);
    expect(generated.directions[0]?.hook).toContain(brand.name);
  });

  it("creates only the requested number of selected outputs", () => {
    const brand = brands[0];
    if (!brand) throw new Error("Mock brand fixture is missing.");

    let state = workflowReducer(initialWorkflowState, {
      type: "select-brand",
      brand
    });
    state = workflowReducer(state, {
      type: "generate-directions",
      directions: buildDirectionFixtures(brand.name)
    });
    state = workflowReducer(state, { type: "auto-select-directions" });
    state = workflowReducer(state, { type: "create-outputs" });

    expect(state.stage).toBe("studio");
    expect(state.outputs).toHaveLength(initialWorkflowState.quantity);
  });

  it("requires individual client approvals before delivery is ready", () => {
    const brand = brands[0];
    if (!brand) throw new Error("Mock brand fixture is missing.");

    let state = workflowReducer(initialWorkflowState, {
      type: "select-brand",
      brand
    });
    state = workflowReducer(state, {
      type: "generate-directions",
      directions: buildDirectionFixtures(brand.name)
    });
    state = workflowReducer(state, { type: "auto-select-directions" });
    state = workflowReducer(state, { type: "create-outputs" });
    state = workflowReducer(state, { type: "send-client" });

    for (const output of state.outputs) {
      state = workflowReducer(state, {
        type: "approve-output",
        id: output.id
      });
    }

    expect(
      state.outputs.every((output) => output.clientStatus === "approved")
    ).toBe(true);
  });

  it("only marks the run approved once every role approves every creative", () => {
    const brand = brands[0];
    if (!brand) throw new Error("Mock brand fixture is missing.");

    let state = workflowReducer(initialWorkflowState, {
      type: "select-brand",
      brand
    });
    state = workflowReducer(state, {
      type: "generate-directions",
      directions: buildDirectionFixtures(brand.name)
    });
    state = workflowReducer(state, { type: "auto-select-directions" });
    state = workflowReducer(state, { type: "create-outputs" });
    state = workflowReducer(state, { type: "run-qa", results: passingQaResults(state) });

    const [first, ...rest] = state.outputs;
    if (!first) throw new Error("Expected at least one output.");

    state = workflowReducer(state, {
      type: "review-output",
      id: first.id,
      role: "graphicDesign",
      decision: "approved"
    });
    expect(state.approved).toBe(false);

    state = workflowReducer(state, {
      type: "review-output",
      id: first.id,
      role: "clientService",
      decision: "approved"
    });
    state = workflowReducer(state, {
      type: "review-output",
      id: first.id,
      role: "projectManager",
      decision: "approved"
    });
    expect(state.approved).toBe(false);

    for (const output of rest) {
      for (const role of ["graphicDesign", "clientService", "projectManager"] as const) {
        state = workflowReducer(state, {
          type: "review-output",
          id: output.id,
          role,
          decision: "approved"
        });
      }
    }

    expect(state.approved).toBe(true);
  });

  it("marks a creative needing revision on rejection, independent of other creatives", () => {
    const brand = brands[0];
    if (!brand) throw new Error("Mock brand fixture is missing.");

    let state = workflowReducer(initialWorkflowState, {
      type: "select-brand",
      brand
    });
    state = workflowReducer(state, {
      type: "generate-directions",
      directions: buildDirectionFixtures(brand.name)
    });
    state = workflowReducer(state, { type: "auto-select-directions" });
    state = workflowReducer(state, { type: "create-outputs" });
    state = workflowReducer(state, { type: "run-qa", results: passingQaResults(state) });

    const [first, second] = state.outputs;
    if (!first || !second) throw new Error("Expected at least two outputs.");

    state = workflowReducer(state, {
      type: "review-output",
      id: first.id,
      role: "graphicDesign",
      decision: "rejected"
    });

    const updatedFirst = state.outputs.find((output) => output.id === first.id);
    const updatedSecond = state.outputs.find((output) => output.id === second.id);
    expect(updatedFirst?.status).toBe("needs-revision");
    expect(updatedFirst?.approval.graphicDesign).toBe("rejected");
    expect(updatedSecond?.status).not.toBe("needs-revision");
  });

  it("resets all approvals and bumps revision count when a replacement asset is uploaded", () => {
    const brand = brands[0];
    if (!brand) throw new Error("Mock brand fixture is missing.");

    let state = workflowReducer(initialWorkflowState, {
      type: "select-brand",
      brand
    });
    state = workflowReducer(state, {
      type: "generate-directions",
      directions: buildDirectionFixtures(brand.name)
    });
    state = workflowReducer(state, { type: "auto-select-directions" });
    state = workflowReducer(state, { type: "create-outputs" });
    state = workflowReducer(state, { type: "run-qa", results: passingQaResults(state) });

    const [first] = state.outputs;
    if (!first) throw new Error("Expected at least one output.");

    state = workflowReducer(state, {
      type: "review-output",
      id: first.id,
      role: "graphicDesign",
      decision: "approved"
    });
    state = workflowReducer(state, {
      type: "review-output",
      id: first.id,
      role: "clientService",
      decision: "approved"
    });

    state = workflowReducer(state, {
      type: "replace-output-asset",
      id: first.id,
      assetUrl: "https://example.supabase.co/storage/v1/object/sign/creative-assets/v2.png",
      assetStoragePath: "brand/run/outputs/hook-1-v2.png",
      assetBucket: "creative-assets"
    });

    const updated = state.outputs.find((output) => output.id === first.id);
    expect(updated?.revisionCount).toBe(first.revisionCount + 1);
    expect(updated?.status).toBe("fixed");
    expect(updated?.approval).toEqual({
      graphicDesign: null,
      clientService: null,
      projectManager: null
    });
    expect(updated?.assetUrl).toContain("v2.png");
  });

  it("appends generated-more directions instead of replacing existing ones", () => {
    const brand = brands[0];
    if (!brand) throw new Error("Mock brand fixture is missing.");

    let state = workflowReducer(initialWorkflowState, {
      type: "select-brand",
      brand
    });
    state = workflowReducer(state, {
      type: "generate-directions",
      directions: buildDirectionFixtures(brand.name)
    });
    expect(state.directions).toHaveLength(6);

    state = workflowReducer(state, {
      type: "generate-more-directions",
      directions: buildDirectionFixtures(brand.name)
    });

    expect(state.directions).toHaveLength(12);
    // Fixture ids collide (direction-1..6 both times) — the reducer must
    // reassign the newly appended batch's ids so nothing is silently lost.
    const ids = state.directions.map((direction) => direction.id);
    expect(new Set(ids).size).toBe(12);
  });

  it("toggles reference images on and off by id", () => {
    const item = { id: "logo-1", url: "https://example.com/logo.png", label: "Logo" };

    let state = workflowReducer(initialWorkflowState, {
      type: "toggle-reference-image",
      item
    });
    expect(state.referenceImages).toEqual([item]);

    state = workflowReducer(state, {
      type: "toggle-reference-image",
      item
    });
    expect(state.referenceImages).toEqual([]);
  });
});
