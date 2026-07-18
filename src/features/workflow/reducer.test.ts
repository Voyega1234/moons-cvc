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
  it("keeps standard artwork generation as the default and allows other modes", () => {
    expect(initialWorkflowState.artworkMode).toBe("standard");

    const updated = workflowReducer(initialWorkflowState, {
      type: "set-artwork-mode",
      mode: "design-system"
    });

    expect(updated.artworkMode).toBe("design-system");

    const referenceLibrary = workflowReducer(updated, {
      type: "set-artwork-mode",
      mode: "reference-library"
    });

    expect(referenceLibrary.artworkMode).toBe("reference-library");
  });

  it("defaults image prompt writing to GPT 5.6 and allows OpenRouter Claude", () => {
    expect(initialWorkflowState.imagePromptModel).toBe("gpt-5.6-terra");

    const updated = workflowReducer(initialWorkflowState, {
      type: "set-image-prompt-model",
      model: "anthropic/claude-sonnet-4.6"
    });

    expect(updated.imagePromptModel).toBe("anthropic/claude-sonnet-4.6");
  });

  it("defaults output size to square and allows larger landscape output", () => {
    expect(initialWorkflowState.outputSize).toBe("1024x1024");

    const updated = workflowReducer(initialWorkflowState, {
      type: "set-output-size",
      size: "3840x2160"
    });

    expect(updated.outputSize).toBe("3840x2160");
  });

  it("defaults the success metric to CVR and allows a brief-specific choice", () => {
    expect(initialWorkflowState.successMetric).toBe("CVR");

    const updated = workflowReducer(initialWorkflowState, {
      type: "set-success-metric",
      metric: "ROAS"
    });

    expect(updated.successMetric).toBe("ROAS");
  });

  it("defaults to the fixed Static, UGC, and Album monthly mix", () => {
    expect(initialWorkflowState.creativeMix).toEqual([
      { id: "creative-mix-1", service: "single-static", quantity: 3 },
      { id: "creative-mix-2", service: "ugc-video", quantity: 2 },
      { id: "creative-mix-3", service: "album-post", quantity: 1 }
    ]);
    expect(initialWorkflowState.quantity).toBe(6);
    expect(initialWorkflowState.brief).toHaveLength(440);

    const updated = workflowReducer(initialWorkflowState, {
      type: "set-creative-mix-quantity",
      id: "creative-mix-3",
      quantity: 2
    });
    expect(updated.creativeMix?.[2]?.quantity).toBe(2);
    expect(updated.quantity).toBe(7);
  });

  it("applies the prototype monthly quota without exceeding six deliverables", () => {
    const state = workflowReducer(initialWorkflowState, {
      type: "apply-monthly-quota"
    });

    expect(state.creativeMix?.map(({ service, quantity }) => ({
      service,
      quantity
    }))).toEqual([
      { service: "single-static", quantity: 3 },
      { service: "ugc-video", quantity: 2 },
      { service: "album-post", quantity: 1 }
    ]);
    expect(state.quantity).toBe(6);
  });

  it("moves from brand selection to generated directions", () => {
    const brand = brands[0];
    if (!brand) throw new Error("Mock brand fixture is missing.");

    const selected = workflowReducer(initialWorkflowState, {
      type: "select-brand",
      brand
    });
    const generating = workflowReducer(selected, {
      type: "start-idea-generation"
    });
    expect(generating.ideaGenerationStatus).toBe("running");

    const generated = workflowReducer(generating, {
      type: "generate-directions",
      directions: buildDirectionFixtures(brand.name)
    });

    expect(generated.stage).toBe("directions");
    expect(generated.ideaGenerationStatus).toBe("idle");
    expect(generated.ideaGenerationError).toBeNull();
    expect(generated.directions).toHaveLength(6);
    expect(generated.directions[0]?.hook).toContain(brand.name);
  });

  it("assigns generated directions to the requested content-type quotas", () => {
    const mixedState: WorkflowState = {
      ...initialWorkflowState,
      creativeMix: [
        { id: "static", service: "single-static", quantity: 3 },
        { id: "album", service: "album-post", quantity: 1 },
        { id: "ugc", service: "ugc-video", quantity: 2 }
      ],
      quantity: 6
    };

    const generated = workflowReducer(mixedState, {
      type: "generate-directions",
      directions: buildDirectionFixtures("Mixed")
    });

    expect(generated.directions.map((direction) => direction.service)).toEqual([
      "single-static",
      "single-static",
      "single-static",
      "album-post",
      "ugc-video",
      "ugc-video"
    ]);
  });

  it("preserves +2 candidate types and strips flow beats from Static only", () => {
    const template = buildDirectionFixtures("Candidate")[0]!;
    const beats = ["Beat one", "Beat two", "Beat three"];
    const directions = ([
      "single-static",
      "ugc-video",
      "album-post"
    ] as const).flatMap((service) =>
      Array.from({ length: 3 }, (_, index) => ({
        ...template,
        id: `${service}-${index + 1}`,
        service,
        formatBeats: service === "single-static" ? ["Wrong motion flow"] : beats
      }))
    );
    const state: WorkflowState = {
      ...initialWorkflowState,
      creativeMix: [
        { id: "static", service: "single-static", quantity: 1 },
        { id: "ugc", service: "ugc-video", quantity: 1 },
        { id: "album", service: "album-post", quantity: 1 }
      ],
      quantity: 3
    };

    const generated = workflowReducer(state, {
      type: "generate-directions",
      directions
    });

    expect(generated.directions.map((direction) => direction.service)).toEqual(
      directions.map((direction) => direction.service)
    );
    expect(
      generated.directions
        .filter((direction) => direction.service === "single-static")
        .every((direction) => direction.formatBeats?.length === 0)
    ).toBe(true);
    expect(
      generated.directions
        .filter((direction) => direction.service === "ugc-video")
        .every((direction) => direction.formatBeats?.length === 3)
    ).toBe(true);
    expect(
      generated.directions
        .filter((direction) => direction.service === "album-post")
        .every((direction) => direction.formatBeats?.length === 3)
    ).toBe(true);
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

  it("keeps artwork generation running across stage changes", () => {
    let state = workflowReducer(initialWorkflowState, {
      type: "start-artwork-generation"
    });

    state = workflowReducer(state, { type: "set-stage", stage: "studio" });
    state = workflowReducer(state, {
      type: "set-stage",
      stage: "directions"
    });

    expect(state.artworkGenerationStatus).toBe("running");
    expect(state.artworkGenerationError).toBeNull();

    state = workflowReducer(state, { type: "create-outputs", outputs: [] });

    expect(state.artworkGenerationStatus).toBe("idle");
    expect(state.artworkGenerationError).toBeNull();
  });

  it("keeps a saved Build reference on the creative output", () => {
    const output = {
      id: "output-reference",
      directionId: "direction-reference",
      format: "Static",
      status: "ready" as const,
      clientStatus: "queued" as const,
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
    };
    const state = workflowReducer(
      { ...initialWorkflowState, outputs: [output] },
      { type: "save-output-reference", id: output.id }
    );

    expect(state.outputs[0]?.savedToReferences).toBe(true);
  });

  it("limits manual selection to each content-type quota", () => {
    const directions = buildDirectionFixtures("Quota").slice(0, 3).map(
      (direction) => ({
        ...direction,
        service: "single-static" as const
      })
    );
    let state: WorkflowState = {
      ...initialWorkflowState,
      creativeMix: [
        { id: "static", service: "single-static", quantity: 1 }
      ],
      service: "single-static",
      quantity: 1,
      directions
    };

    state = workflowReducer(state, {
      type: "toggle-direction",
      id: directions[0]!.id
    });
    state = workflowReducer(state, {
      type: "toggle-direction",
      id: directions[1]!.id
    });

    expect(state.directions.map((direction) => direction.selected)).toEqual([
      true,
      false,
      false
    ]);
  });

  it("adds and deletes a manual hook without changing the quota", () => {
    let state = workflowReducer(initialWorkflowState, {
      type: "add-manual-direction",
      service: "ugc-video",
      pillar: "Product proof",
      objective: "Conversion",
      hook: "A manually written hook",
      subheadline: "A supporting line",
      cta: "See how it works"
    });

    const manual = state.directions[0];
    expect(manual).toMatchObject({
      service: "ugc-video",
      manual: true,
      pillar: "Product proof",
      objective: "Conversion",
      hook: "A manually written hook",
      selected: false
    });
    expect(state.quantity).toBe(initialWorkflowState.quantity);

    state = workflowReducer(state, {
      type: "delete-direction",
      id: manual!.id
    });
    expect(state.directions).toEqual([]);
  });

  it("creates outputs in the quantities and formats requested by the mix", () => {
    const brand = brands[0];
    if (!brand) throw new Error("Mock brand fixture is missing.");

    let state = initialWorkflowState;
    state = workflowReducer(state, { type: "select-brand", brand });
    state = workflowReducer(state, {
      type: "generate-directions",
      directions: buildDirectionFixtures(brand.name)
    });
    state = workflowReducer(state, { type: "auto-select-directions" });
    state = workflowReducer(state, { type: "create-outputs" });

    expect(state.outputs.map((output) => output.format)).toEqual([
      "1:1 Static",
      "1:1 Static",
      "1:1 Static",
      "9:16 UGC",
      "9:16 UGC",
      "Album post"
    ]);
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
      decision: "approved",
      comment: "Ready for client service review."
    });
    expect(state.approved).toBe(false);

    state = workflowReducer(state, {
      type: "review-output",
      id: first.id,
      role: "clientService",
      decision: "approved",
      comment: ""
    });
    state = workflowReducer(state, {
      type: "review-output",
      id: first.id,
      role: "projectManager",
      decision: "approved",
      comment: ""
    });
    expect(state.approved).toBe(false);

    for (const output of rest) {
      for (const role of ["graphicDesign", "clientService", "projectManager"] as const) {
        state = workflowReducer(state, {
          type: "review-output",
          id: output.id,
          role,
          decision: "approved",
          comment: ""
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
      decision: "rejected",
      comment: "Logo needs more breathing room."
    });

    const updatedFirst = state.outputs.find((output) => output.id === first.id);
    const updatedSecond = state.outputs.find((output) => output.id === second.id);
    expect(updatedFirst?.status).toBe("needs-revision");
    expect(updatedFirst?.approval.graphicDesign).toBe("rejected");
    expect(updatedFirst?.approvalComments.graphicDesign).toBe(
      "Logo needs more breathing room."
    );
    expect(updatedSecond?.status).not.toBe("needs-revision");
  });

  it("does not record a rejection without a comment", () => {
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
    state = workflowReducer(state, {
      type: "run-qa",
      results: passingQaResults(state)
    });

    const output = state.outputs[0];
    if (!output) throw new Error("Expected a generated output.");
    const before = state;

    state = workflowReducer(state, {
      type: "review-output",
      id: output.id,
      role: "graphicDesign",
      decision: "rejected",
      comment: "   "
    });

    expect(state).toBe(before);
    expect(state.outputs[0]?.approval.graphicDesign).toBeNull();
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
      decision: "approved",
      comment: ""
    });
    state = workflowReducer(state, {
      type: "review-output",
      id: first.id,
      role: "clientService",
      decision: "approved",
      comment: ""
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
    expect(updated?.status).toBe("draft");
    expect(updated?.qaNote).toBeUndefined();
    expect(updated?.qaReport).toBeUndefined();
    expect(state.qaComplete).toBe(false);
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

  it("replaces one hook without changing its identity or selection", () => {
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

    const firstDirection = state.directions[0];
    if (!firstDirection) throw new Error("Expected a generated direction.");
    state = workflowReducer(state, {
      type: "set-direction-export-group",
      id: firstDirection.id,
      group: "recommended"
    });

    const original = state.directions[0];
    if (!original) throw new Error("Expected a generated direction.");

    state = workflowReducer(state, {
      type: "replace-direction",
      id: original.id,
      direction: {
        ...original,
        id: "regenerated-id-that-must-not-be-used",
        exportGroup: null,
        selected: false,
        hook: "A sharper regenerated hook"
      }
    });

    const replaced = state.directions[0];
    expect(replaced?.id).toBe(original.id);
    expect(replaced?.selected).toBe(original.selected);
    expect(replaced?.exportGroup).toBe("recommended");
    expect(replaced?.hook).toBe("A sharper regenerated hook");
    expect(state.outputs).toEqual([]);
    expect(state.qaComplete).toBe(false);
  });

  it("replaces every hook while preserving each identity and selection", () => {
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

    const firstDirection = state.directions[0];
    if (!firstDirection) throw new Error("Expected a generated direction.");
    state = workflowReducer(state, {
      type: "set-direction-export-group",
      id: firstDirection.id,
      group: "option"
    });

    const identities = state.directions.map(({ id, selected }) => ({
      id,
      selected
    }));
    const replacements = state.directions.map((direction, index) => ({
      ...direction,
      id: `replacement-${index}`,
      exportGroup: null,
      selected: !direction.selected,
      hook: `Regenerated hook ${index + 1}`,
      subheadline: `Regenerated subheadline ${index + 1}`,
      concept: `Regenerated concept ${index + 1}`
    }));

    state = workflowReducer(state, {
      type: "replace-directions",
      directions: replacements
    });

    expect(
      state.directions.map(({ id, selected }) => ({ id, selected }))
    ).toEqual(identities);
    expect(state.directions[0]?.hook).toBe("Regenerated hook 1");
    expect(state.directions[0]?.subheadline).toBe("Regenerated subheadline 1");
    expect(state.directions[0]?.concept).toBe("Regenerated concept 1");
    expect(state.directions[0]?.exportGroup).toBe("option");
    expect(state.outputs).toEqual([]);
    expect(state.qaComplete).toBe(false);
  });

  it("resets Build quality status after a caption edit", () => {
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
    state = workflowReducer(state, {
      type: "run-qa",
      results: passingQaResults(state)
    });

    const output = state.outputs[0];
    const direction = state.directions.find(
      (candidate) => candidate.id === output?.directionId
    );
    if (!output || !direction) {
      throw new Error("Expected a creative output and direction.");
    }

    state = workflowReducer(state, {
      type: "edit-output-direction",
      id: output.id,
      hook: direction.hook,
      caption: "Updated caption for Build review.",
      formatBeats: direction.formatBeats ?? []
    });

    expect(state.qaComplete).toBe(false);
    expect(state.outputs[0]?.status).toBe("draft");
    expect(state.outputs[0]?.qaNote).toBeUndefined();
    expect(
      state.directions.find((candidate) => candidate.id === direction.id)
        ?.caption
    ).toBe("Updated caption for Build review.");
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

  it("selects a default reference image without toggling an existing selection", () => {
    const item = {
      id: "library-logo-1",
      url: "https://example.com/logo.png",
      label: "Logo"
    };

    const selected = workflowReducer(initialWorkflowState, {
      type: "select-reference-image",
      item
    });
    expect(selected.referenceImages).toEqual([item]);

    const selectedAgain = workflowReducer(selected, {
      type: "select-reference-image",
      item
    });
    expect(selectedAgain).toBe(selected);
  });

  it("separates selected references when the client changes", () => {
    const baseBrand = brands[0];
    if (!baseBrand) throw new Error("Mock brand fixture is missing.");
    const sleepHappy = {
      ...baseBrand,
      id: "sleep-happy",
      name: "SleepHappy"
    };
    const convertCake = {
      ...baseBrand,
      id: "convert-cake",
      name: "Convert Cake"
    };
    const state = {
      ...initialWorkflowState,
      brand: sleepHappy,
      referenceImages: [
        {
          id: "sleep-happy-logo",
          url: "https://example.com/sleep-happy.png",
          label: "Logo"
        }
      ]
    };

    const selected = workflowReducer(state, {
      type: "select-brand",
      brand: convertCake
    });

    expect(selected.referenceImages).toEqual([]);
  });

  it("replaces a stale client logo while preserving other references", () => {
    const state = {
      ...initialWorkflowState,
      referenceImages: [
        {
          id: "sleep-happy-logo",
          url: "https://example.com/sleep-happy.png",
          label: "Logo"
        },
        {
          id: "convert-cake-past-work",
          url: "https://example.com/convert-cake-post.png",
          label: "Past work"
        }
      ]
    };

    const synced = workflowReducer(state, {
      type: "sync-brand-logo-reference",
      item: {
        id: "convert-cake-logo",
        url: "https://example.com/convert-cake-logo.png",
        label: "Logo"
      }
    });

    expect(synced.referenceImages).toEqual([
      state.referenceImages[1],
      {
        id: "convert-cake-logo",
        url: "https://example.com/convert-cake-logo.png",
        label: "Logo"
      }
    ]);
  });

  it("routes a commented client change request back to Internal QC", () => {
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
    state = workflowReducer(state, {
      type: "run-qa",
      results: passingQaResults(state)
    });
    state = workflowReducer(state, { type: "approve-all" });
    state = workflowReducer(state, { type: "send-client" });

    const [approvedOutput, revisionOutput] = state.outputs;
    if (!approvedOutput || !revisionOutput) {
      throw new Error("Expected at least two creative outputs.");
    }
    state = workflowReducer(state, {
      type: "approve-output",
      id: approvedOutput.id
    });

    const beforeBlankRequest = state;
    state = workflowReducer(state, {
      type: "request-client-change",
      id: revisionOutput.id,
      comment: "   "
    });
    expect(state).toBe(beforeBlankRequest);

    state = workflowReducer(state, {
      type: "request-client-change",
      id: revisionOutput.id,
      comment: "Make the product benefit easier to scan."
    });

    const updatedRevision = state.outputs.find(
      (output) => output.id === revisionOutput.id
    );
    expect(state.stage).toBe("approval");
    expect(state.approved).toBe(false);
    expect(state.clientSent).toBe(false);
    expect(updatedRevision?.status).toBe("needs-revision");
    expect(updatedRevision?.clientStatus).toBe("revision");
    expect(updatedRevision?.approval.projectManager).toBe("rejected");
    expect(updatedRevision?.approvalComments.projectManager).toBe(
      "Make the product benefit easier to scan."
    );
    expect(state.outputs[0]?.clientStatus).toBe("approved");

    state = workflowReducer(state, {
      type: "review-output",
      id: revisionOutput.id,
      role: "projectManager",
      decision: "approved",
      comment: "Client change completed."
    });
    state = workflowReducer(state, { type: "send-client" });

    expect(state.outputs[0]?.clientStatus).toBe("approved");
    expect(state.outputs[1]?.clientStatus).toBe("sent");
  });

  it("adds, annotates, and removes uploaded creative image materials", () => {
    const material = {
      id: "material-1",
      name: "product.png",
      mediaType: "image/png",
      role: "main-object" as const,
      description: "",
      url: "https://example.com/product.png"
    };
    let state = workflowReducer(initialWorkflowState, {
      type: "add-uploaded-materials",
      items: [material]
    });
    expect(state.uploadedMaterials).toEqual([material]);

    state = workflowReducer(state, {
      type: "update-uploaded-material",
      id: material.id,
      changes: {
        role: "supporting-component",
        description: "Use beside the headline"
      }
    });
    expect(state.uploadedMaterials[0]).toMatchObject({
      role: "supporting-component",
      description: "Use beside the headline"
    });

    state = workflowReducer(state, {
      type: "remove-uploaded-material",
      id: material.id
    });
    expect(state.uploadedMaterials).toEqual([]);
  });
});
