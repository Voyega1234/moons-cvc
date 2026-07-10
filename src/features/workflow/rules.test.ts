import { describe, expect, it } from "vitest";
import { brands } from "../../data/mock-brands";
import {
  canNavigateToStage,
  highestUnlockedStageIndex,
  isStageComplete,
  workflowActionBlockReason
} from "./rules";
import {
  createInitialWorkflowState,
  workflowReducer
} from "./reducer";
import { buildDirectionFixtures } from "./test-fixtures";

describe("workflow rules", () => {
  it("locks later steps until the preceding requirement is complete", () => {
    const brand = brands[0];
    if (!brand) throw new Error("Mock brand fixture is missing.");

    let run = createInitialWorkflowState({
      id: "run-1",
      now: "2026-06-23T10:00:00.000Z"
    });

    expect(highestUnlockedStageIndex(run)).toBe(0);
    expect(canNavigateToStage(run, "brief")).toBe(false);

    run = workflowReducer(run, { type: "select-brand", brand });

    expect(isStageComplete(run, "start")).toBe(true);
    expect(highestUnlockedStageIndex(run)).toBe(1);
    expect(canNavigateToStage(run, "brief")).toBe(true);
    expect(canNavigateToStage(run, "directions")).toBe(false);
  });

  it("invalidates generated work when the service changes", () => {
    const brand = brands[0];
    if (!brand) throw new Error("Mock brand fixture is missing.");

    let run = createInitialWorkflowState({
      id: "run-1",
      now: "2026-06-23T10:00:00.000Z"
    });
    run = workflowReducer(run, { type: "select-brand", brand });
    run = workflowReducer(run, {
      type: "generate-directions",
      directions: buildDirectionFixtures(brand.name)
    });
    run = workflowReducer(run, { type: "auto-select-directions" });
    run = workflowReducer(run, { type: "create-outputs" });
    run = workflowReducer(run, {
      type: "run-qa",
      results: run.outputs.map((output) => ({
        outputId: output.id,
        passed: true,
        reason: "Looks good."
      }))
    });
    run = workflowReducer(run, { type: "approve-all" });
    run = workflowReducer(run, { type: "set-service", service: "album-post" });

    expect(run.directions).toEqual([]);
    expect(run.outputs).toEqual([]);
    expect(run.qaComplete).toBe(false);
    expect(run.approved).toBe(false);
    expect(run.clientSent).toBe(false);
    expect(run.done).toBe(false);
  });

  it("explains why guarded actions are unavailable", () => {
    let run = createInitialWorkflowState({
      id: "run-1",
      now: "2026-06-23T10:00:00.000Z"
    });

    expect(
      workflowActionBlockReason(run, {
        type: "generate-directions",
        directions: []
      })
    ).toBe("Choose a brand first.");

    const brand = brands[0];
    if (!brand) throw new Error("Mock brand fixture is missing.");

    run = workflowReducer(run, { type: "select-brand", brand });
    run = workflowReducer(run, {
      type: "generate-directions",
      directions: buildDirectionFixtures(brand.name)
    });

    expect(workflowActionBlockReason(run, { type: "create-outputs" })).toBe(
      `Select ${run.quantity} hooks first.`
    );
  });
});
