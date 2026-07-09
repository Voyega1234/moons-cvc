import { describe, expect, it } from "vitest";
import { brands } from "../../data/mock-brands";
import {
  initialWorkflowState,
  workflowReducer
} from "./reducer";
import { buildDirectionFixtures } from "./test-fixtures";

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
});
