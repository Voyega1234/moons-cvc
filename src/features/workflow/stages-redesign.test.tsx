import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { brands } from "../../data/mock-brands";
import { BrandMemoryProvider } from "../../app/providers/brand-memory-provider";
import { MockBrandMemoryRepository } from "../../repositories/brand-memory/mock-brand-memory-repository";
import { createInitialWorkflowState, workflowReducer } from "./reducer";
import {
  ApprovalStage,
  BriefStage,
  ClientStage,
  DirectionsStage,
  StudioStage
} from "./stages";
import { buildDirectionFixtures } from "./test-fixtures";
import { buildAngleExportReview } from "./angle-content-types";

function buildCreativeState() {
  const brand = brands[0];
  if (!brand) throw new Error("Mock brand fixture is missing.");

  let state = createInitialWorkflowState({
    id: "run-redesign",
    now: "2026-07-13T00:00:00.000Z"
  });
  state = workflowReducer(state, { type: "select-brand", brand });
  state = workflowReducer(state, {
    type: "generate-directions",
    directions: buildDirectionFixtures(brand.name)
  });
  state = workflowReducer(state, { type: "auto-select-directions" });
  return workflowReducer(state, { type: "create-outputs" });
}

function buildClientState() {
  let state = buildCreativeState();
  state = workflowReducer(state, {
    type: "run-qa",
    results: state.outputs.map((output) => ({
      outputId: output.id,
      passed: true,
      reason: "Looks good."
    }))
  });
  state = workflowReducer(state, { type: "approve-all" });
  return workflowReducer(state, { type: "send-client" });
}

function buildMixedAngleState() {
  const base = buildCreativeState();
  const mixed = {
    ...base,
    stage: "brief" as const,
    creativeMix: [
      { id: "static", service: "single-static" as const, quantity: 3 },
      { id: "album", service: "album-post" as const, quantity: 1 },
      { id: "ugc", service: "ugc-video" as const, quantity: 2 }
    ],
    quantity: 6,
    directions: []
  };
  const generated = workflowReducer(mixed, {
    type: "generate-directions",
    directions: buildDirectionFixtures("Mixed")
  });
  return workflowReducer(generated, { type: "auto-select-directions" });
}

describe("redesigned workflow stages", () => {
  it("presents Brief with the prototype's creative and signal controls", async () => {
    const user = userEvent.setup();
    const state = buildCreativeState();
    const dispatch = vi.fn();
    const view = render(
      <BrandMemoryProvider repository={new MockBrandMemoryRepository()}>
        <BriefStage state={{ ...state, stage: "brief" }} dispatch={dispatch} />
      </BrandMemoryProvider>
    );
    const stage = within(view.container);

    expect(stage.getByRole("heading", { name: "Creative mix" })).toBeTruthy();
    expect(stage.getByRole("heading", { name: "Signal stack" })).toBeTruthy();
    expect(
      stage.getByRole("heading", { name: "Primary success metric" })
    ).toBeTruthy();
    expect(stage.getByRole("combobox", { name: "Content type 1" })).toBeTruthy();
    expect(
      stage.getByRole("spinbutton", { name: "Single static quantity" })
    ).toBeTruthy();

    await user.click(stage.getByRole("button", { name: "Add item" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "add-creative-mix-item" });

    await user.selectOptions(
      stage.getByRole("combobox", { name: "Content type 1" }),
      "album-post"
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "set-creative-mix-service",
      id: "creative-mix-1",
      service: "album-post"
    });

    await user.click(stage.getByRole("button", { name: /ROAS/i }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "set-success-metric",
      metric: "ROAS"
    });
  });

  it("presents Angles as the prototype-style hook selection workspace", async () => {
    const user = userEvent.setup();
    const baseState = buildCreativeState();
    const state = {
      ...baseState,
      directions: baseState.directions.map((direction, index) => ({
        ...direction,
        exportGroup:
          index === 0
            ? ("recommended" as const)
            : index === 1
              ? ("option" as const)
              : null
      }))
    };
    const dispatch = vi.fn();
    const view = render(
      <DirectionsStage state={{ ...state, stage: "directions" }} dispatch={dispatch} />
    );
    const stage = within(view.container);

    expect(view.container.querySelector(".neo-stage-angles")).toBeTruthy();
    expect(stage.getByRole("heading", { name: "Review recommended hooks" })).toBeTruthy();
    const angleCards = view.container.querySelectorAll(".neo-angle-card");
    expect(angleCards).toHaveLength(state.directions.length);
    expect(angleCards[0]?.querySelector(".neo-angle-badge-row")).toBeTruthy();
    expect(angleCards[0]?.querySelector(".neo-angle-hook-wrap")).toBeTruthy();
    expect(angleCards[0]?.querySelectorAll(".neo-angle-copy-block")).toHaveLength(3);
    expect(angleCards[0]?.querySelector(".neo-angle-card-foot")).toBeTruthy();
    expect(within(angleCards[0] as HTMLElement).getByText("Subheadline 1")).toBeTruthy();
    expect(within(angleCards[0] as HTMLElement).getByText("Concept 1")).toBeTruthy();
    expect(stage.getAllByRole("button", { name: "Edit" })).toHaveLength(
      state.directions.length
    );
    expect(
      within(angleCards[0] as HTMLElement)
        .getByRole("combobox", { name: "Export group for Idea 1" })
        .closest(".neo-angle-top-actions")
    ).toBeTruthy();
    expect(
      Array.from(
        angleCards[0]?.querySelectorAll(".neo-angle-card-foot .btn") ?? []
      ).map((button) => button.textContent)
    ).toEqual(["Edit", "Regenerate"]);
    expect(stage.getAllByRole("button", { name: "Regenerate" })).toHaveLength(
      state.directions.length
    );
    expect(stage.queryByRole("button", { name: "Adjust bold" })).toBeNull();
    expect(
      stage.getAllByRole("combobox", { name: /Export group for Idea/ })
    ).toHaveLength(state.directions.length);
    expect(
      stage
        .getByRole("combobox", { name: "Export group for Idea 1" })
        .classList.contains("is-recommended")
    ).toBe(true);
    expect(
      stage
        .getByRole("combobox", { name: "Export group for Idea 2" })
        .classList.contains("is-option")
    ).toBe(true);

    await user.selectOptions(
      stage.getByRole("combobox", { name: "Export group for Idea 1" }),
      "recommended"
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "set-direction-export-group",
      id: state.directions[0]?.id,
      group: "recommended"
    });

    await user.click(
      stage.getByRole("button", { name: "Deselect Idea 1 card" })
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "toggle-direction",
      id: state.directions[0]?.id
    });
  });

  it("groups the Angle export into recommended topics and other options", () => {
    const state = buildMixedAngleState();
    const view = render(<DirectionsStage state={state} dispatch={vi.fn()} />);
    const stage = within(view.container);
    const headings = Array.from(
      view.container.querySelectorAll(".neo-angle-group-title h3")
    ).map((node) => node.textContent);

    expect(headings).toEqual(["Static hooks", "Album hooks", "UGC video hooks"]);
    expect(stage.getAllByText("STATIC AD")).toHaveLength(3);
    expect(stage.getAllByText("ALBUM AD")).toHaveLength(1);
    expect(stage.getAllByText("UGC VIDEO")).toHaveLength(2);
    expect(stage.getByRole("button", { name: "Export PDF" })).toBeTruthy();
    expect(buildAngleExportReview(state).sections).toEqual([]);

    const classifiedDirections = state.directions.map((direction, index) => ({
      ...direction,
      exportGroup:
        index === 0 || index === 3
          ? ("recommended" as const)
          : index === 1 || index === 4
            ? ("option" as const)
            : null
    }));
    const reorderedState = {
      ...state,
      directions: [
        classifiedDirections[4]!,
        classifiedDirections[3]!,
        classifiedDirections[0]!,
        classifiedDirections[5]!,
        classifiedDirections[1]!,
        classifiedDirections[2]!
      ]
    };
    const review = buildAngleExportReview(reorderedState);
    expect(review.sections.map((section) => section.heading)).toEqual([
      "Recommended topics",
      "Other options"
    ]);
    expect(review.sections[0]?.ideas.map((idea) => idea.content_type)).toEqual([
      "STATIC AD",
      "ALBUM AD"
    ]);
    expect(review.sections[1]?.ideas.map((idea) => idea.content_type)).toEqual([
      "STATIC AD",
      "UGC VIDEO"
    ]);
    expect(review.highlightMap["recommended:0"]).toEqual(["Subheadline 1"]);
    expect(review.highlightMap["recommended:1"]).toEqual(["Subheadline 4"]);
    expect(review.highlightMap["option:0"]).toEqual(["Subheadline 2"]);
    expect(review.highlightMap["option:1"]).toEqual(["Subheadline 5"]);
    expect(review.sections[0]?.ideas[0]).toMatchObject({
      concept_idea: "Concept 1",
      copywriting: { sub_headline_1: "Subheadline 1" }
    });
    expect(
      review.sections.flatMap((section) => section.ideas)
    ).toHaveLength(4);
  });

  it("presents Build as a format-grouped draft-review workspace", () => {
    const state = buildCreativeState();
    const view = render(<StudioStage state={state} dispatch={vi.fn()} />);
    const stage = within(view.container);

    expect(view.container.querySelector(".neo-stage-build")).toBeTruthy();
    expect(stage.getByText("Creative set")).toBeTruthy();
    expect(
      stage.getByRole("heading", { name: "1:1 Static creatives" })
    ).toBeTruthy();
    expect(stage.getAllByText(/Creative \d/)).toHaveLength(state.outputs.length);
    const createCards = view.container.querySelectorAll(".neo-create-card");
    expect(createCards).toHaveLength(state.outputs.length);
    expect(createCards[0]?.querySelector(".neo-create-card-badges")).toBeTruthy();
    expect(createCards[0]?.querySelector(".neo-create-hook-wrap")).toBeTruthy();
    expect(createCards[0]?.querySelector(".neo-create-card-foot")).toBeTruthy();
  });

  it("presents Internal QC as a role-focused asset review queue", async () => {
    const user = userEvent.setup();
    const state = buildCreativeState();
    const dispatch = vi.fn();
    const view = render(<ApprovalStage state={state} dispatch={dispatch} />);
    const stage = within(view.container);
    const firstOutput = state.outputs[0];
    if (!firstOutput) throw new Error("Expected a creative output fixture.");

    expect(view.container.querySelector(".neo-stage-qc")).toBeTruthy();
    expect(
      stage
        .getByRole("progressbar", { name: "Internal QC progress" })
        .getAttribute("aria-valuenow")
    ).toBe("0");
    expect(stage.getByRole("heading", { name: "Assets in GD review" })).toBeTruthy();
    expect(
      stage.getAllByText("ความสวยงาม องค์ประกอบ และจุดนำสายตา")
    ).toHaveLength(state.outputs.length);
    expect(
      stage.getAllByText(
        "ตรวจ Logo, Brand CI, ชื่อแบรนด์/สินค้า และข้อความใน Artwork ให้ถูกต้อง"
      )
    ).toHaveLength(state.outputs.length);
    expect(stage.getAllByRole("button", { name: "Approve GD" })).toHaveLength(
      state.outputs.length
    );
    const firstCard = view.container.querySelector(".neo-qc-focus-card");
    const firstCardContent = firstCard?.querySelector(".neo-qc-focus-content");
    expect(firstCardContent?.querySelector(".download-action")).toBeTruthy();
    expect(firstCardContent?.querySelector(".upload-inline")).toBeTruthy();
    expect(
      firstCard?.querySelector(".neo-qc-focus-asset .neo-qc-asset-actions")
    ).toBeNull();
    expect(stage.queryByText("Review route")).toBeNull();
    expect(stage.queryByRole("dialog")).toBeNull();
    expect(
      stage.queryByRole("textbox", { name: "Rejection comment" })
    ).toBeNull();

    await user.click(stage.getAllByRole("button", { name: "Reject" })[0]!);

    expect(stage.getByRole("dialog", { name: "What needs to change?" })).toBeTruthy();
    await user.click(stage.getByRole("button", { name: "Reject creative" }));
    expect(stage.getByText("Add a comment before rejecting.")).toBeTruthy();

    await user.type(
      stage.getByRole("textbox", { name: "Rejection comment" }),
      "Increase the headline contrast."
    );
    await user.click(stage.getByRole("button", { name: "Reject creative" }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "review-output",
      id: firstOutput.id,
      role: "graphicDesign",
      decision: "rejected",
      comment: "Increase the headline contrast."
    });
    expect(stage.queryByRole("dialog")).toBeNull();

    await user.click(stage.getByRole("tab", { name: /CS Review/i }));

    expect(stage.getByRole("heading", { name: "Assets in CS review" })).toBeTruthy();
    expect(
      stage.getAllByText("Key Message ชัด และตรง Brief / Objective")
    ).toHaveLength(state.outputs.length);
    expect(
      stage.getAllByText(
        "งานตรง Client Context หรือ Revision Feedback ถ้าเป็นงานแก้"
      )
    ).toHaveLength(state.outputs.length);
    expect(stage.getAllByRole("button", { name: "Approve CS" })).toHaveLength(
      state.outputs.length
    );
  });

  it("requires client feedback before routing a creative to Internal QC", async () => {
    const user = userEvent.setup();
    const state = buildClientState();
    const dispatch = vi.fn();
    const view = render(<ClientStage state={state} dispatch={dispatch} />);
    const stage = within(view.container);
    const firstOutput = state.outputs[0];
    if (!firstOutput) throw new Error("Expected a creative output fixture.");

    expect(view.container.querySelector(".neo-stage-client")).toBeTruthy();
    expect(
      stage.getByRole("button", { name: "Back to Internal QC" })
    ).toBeTruthy();
    expect(stage.getAllByRole("button", { name: "Request change" })).toHaveLength(
      state.outputs.length
    );

    await user.click(stage.getAllByRole("button", { name: "Request change" })[0]!);
    expect(stage.getByRole("dialog", { name: "Request a change" })).toBeTruthy();

    await user.click(stage.getByRole("button", { name: "Route to Internal QC" }));
    expect(
      stage.getByText("Add a comment before requesting changes.")
    ).toBeTruthy();

    await user.type(
      stage.getByRole("textbox", { name: "Required comment" }),
      "Make the product benefit easier to scan."
    );
    await user.click(stage.getByRole("button", { name: "Route to Internal QC" }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "request-client-change",
      id: firstOutput.id,
      comment: "Make the product benefit easier to scan."
    });
    expect(stage.queryByRole("dialog")).toBeNull();
  });
});
