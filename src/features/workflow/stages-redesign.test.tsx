import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { brands } from "../../data/mock-brands";
import { BrandMemoryProvider } from "../../app/providers/brand-memory-provider";
import { BrandProvider } from "../../app/providers/brand-provider";
import { ClientIntakeProvider } from "../../app/providers/client-intake-provider";
import { MockBrandMemoryRepository } from "../../repositories/brand-memory/mock-brand-memory-repository";
import { MockBrandRepository } from "../../repositories/brands/mock-brand-repository";
import { MockClientIntakeRepository } from "../../repositories/client-intake/mock-client-intake-repository";
import { createInitialWorkflowState, workflowReducer } from "./reducer";
import {
  ApprovalStage,
  BriefStage,
  ClientStage,
  downloadOutputAsset,
  DirectionsStage,
  StartStage,
  StudioStage
} from "./stages";
import { buildDirectionFixtures } from "./test-fixtures";
import { buildAngleExportReview } from "./angle-content-types";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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
  const formatNative = {
    ...generated,
    directions: generated.directions.map((direction) => ({
      ...direction,
      formatBeats:
        direction.service === "album-post"
          ? ["ปัญหาที่คนมองข้าม", "สิ่งที่ควรเปรียบเทียบ", "ทางเลือกที่นำไปใช้ได้"]
          : direction.service === "ugc-video"
            ? ["เปิดด้วยสถานการณ์จริง", "สาธิตให้เห็นผล", "ปิดด้วยทางเลือกของแบรนด์"]
            : []
    }))
  };
  return workflowReducer(formatNative, { type: "auto-select-directions" });
}

describe("redesigned workflow stages", () => {
  it("downloads artwork as a local file instead of opening its storage URL", async () => {
    const output = {
      ...buildCreativeState().outputs[0]!,
      assetUrl: "https://storage.example.com/creative.png",
      assetStoragePath: "run/outputs/creative-01.png"
    };
    const blob = new Blob(["image"], { type: "image/png" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, blob: vi.fn().mockResolvedValue(blob) })
    );
    const createObjectUrl = vi.fn().mockReturnValue("blob:creative-download");
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    await downloadOutputAsset(output, 0);

    expect(fetch).toHaveBeenCalledWith(output.assetUrl);
    expect(createObjectUrl).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:creative-download");
  });

  it("presents Signal with the reference workspace and memory composition", async () => {
    const user = userEvent.setup();
    const state = buildCreativeState();
    const brandRepository = new MockBrandRepository();
    const memoryRepository = new MockBrandMemoryRepository();
    vi.spyOn(memoryRepository, "listBrandRules").mockResolvedValue([
      { id: "colors", title: "Colors", description: "#1D1D1F, #FFFFFF" },
      {
        id: "secondary-colors",
        title: "Secondary colors",
        description: "#5664F5, #D8FF72"
      },
      {
        id: "visual-guidance",
        title: "Visual guidance",
        description:
          "Use bold editorial typography with spacious layouts. Keep product imagery clean and preserve clear visual hierarchy across every placement."
      }
    ]);
    const view = render(
      <BrandProvider
        repository={brandRepository}
        mappingRepository={{ list: async () => [] }}
      >
        <ClientIntakeProvider
          repository={new MockClientIntakeRepository(brandRepository)}
        >
          <BrandMemoryProvider repository={memoryRepository}>
            <StartStage state={{ ...state, stage: "start" }} dispatch={vi.fn()} />
          </BrandMemoryProvider>
        </ClientIntakeProvider>
      </BrandProvider>
    );
    const stage = within(view.container);

    expect(view.container.querySelector(".neo-signal-stage")).toBeTruthy();
    expect(stage.getByText("01 / Signal")).toBeTruthy();
    expect(stage.getByText("Brand workspace")).toBeTruthy();
    expect(stage.getByText("Brand materials")).toBeTruthy();
    expect(stage.getByText(`${state.brand?.name} memory`)).toBeTruthy();
    expect(stage.getByRole("navigation", { name: "Brand memory sections" })).toBeTruthy();
    expect(stage.getByText("Signal before output")).toBeTruthy();
    expect(stage.getByRole("button", { name: "Continue to brief →" })).toBeTruthy();
    expect(
      view.container.querySelectorAll(".brand-colors-section .colors-card")
    ).toHaveLength(2);

    const memoryViewport = view.container.querySelector(
      ".neo-signal-memory-viewport"
    );
    expect(memoryViewport?.classList.contains("collapsed")).toBe(true);
    await user.click(
      stage.getByRole("button", { name: "See more brand memory" })
    );
    expect(memoryViewport?.classList.contains("expanded")).toBe(true);

    await user.click(await stage.findByRole("button", { name: "See more" }));
    expect(stage.getByRole("button", { name: "See less" })).toBeTruthy();

    await user.click(stage.getByRole("button", { name: "Manage library" }));
    expect(
      stage.getByRole("dialog", { name: "Manage brand materials" })
    ).toBeTruthy();
    expect(
      stage.getByRole("navigation", { name: "Brand library folders" })
    ).toBeTruthy();
    await user.click(
      stage.getByRole("button", { name: "Close brand library" })
    );
    expect(stage.queryByRole("dialog", { name: "Manage brand materials" })).toBeNull();
  });

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

    expect(stage.getByText("02 / Brief")).toBeTruthy();
    expect(
      stage.getByText(
        "Set the mix, define the objective, and choose the one metric this creative set should move."
      )
    ).toBeTruthy();
    expect(stage.getByRole("heading", { name: "Creative mix" })).toBeTruthy();
    expect(
      stage.getByRole("heading", { name: "Creative brief" })
    ).toBeTruthy();
    expect(stage.getByRole("heading", { name: "Signal stack" })).toBeTruthy();
    expect(
      stage.getByRole("heading", { name: "Primary success metric" })
    ).toBeTruthy();
    expect(
      stage.getByRole("button", { name: /CTR/i }).getAttribute("aria-pressed")
    ).toBe("true");
    expect(
      stage.getByRole("button", { name: /CVR/i }).getAttribute("aria-pressed")
    ).toBe("false");
    expect(stage.queryByRole("combobox", { name: /Content type/i })).toBeNull();
    expect(stage.queryByRole("button", { name: "Add item" })).toBeNull();
    expect(stage.getByText("Static")).toBeTruthy();
    expect(stage.getByText("UGC")).toBeTruthy();
    expect(stage.getByText("Album")).toBeTruthy();
    expect(
      stage.getByRole("spinbutton", { name: "Static quantity" })
    ).toBeTruthy();
    expect(
      stage.getByRole("spinbutton", { name: "UGC quantity" })
    ).toBeTruthy();
    expect(
      stage.getByRole("spinbutton", { name: "Album quantity" })
    ).toBeTruthy();
    expect(
      (stage.getByRole("textbox", {
        name: /Working brief/i
      }) as HTMLTextAreaElement).value
    ).toContain(
      "Objective: Create Meta performance creatives that make the product benefit instantly clear."
    );

    await user.click(stage.getByRole("button", { name: "Use monthly quota" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "apply-monthly-quota" });

    await user.click(stage.getByRole("button", { name: /ROAS/i }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "set-success-metric",
      metric: "ROAS"
    });

    await user.click(
      stage.getByRole("button", { name: "Manage uploaded materials" })
    );
    expect(
      stage.getByRole("dialog", { name: "Uploaded materials" })
    ).toBeTruthy();
    expect(
      stage.getByRole("navigation", { name: "Uploaded material folders" })
    ).toBeTruthy();
    await user.click(stage.getByRole("button", { name: /References/ }));
    await user.click(
      stage.getByRole("button", { name: "Close uploaded materials" })
    );
    expect(
      stage.queryByRole("dialog", { name: "Uploaded materials" })
    ).toBeNull();
  });

  it("presents Angles as the prototype-style hook selection workspace", async () => {
    const user = userEvent.setup();
    const baseState = buildCreativeState();
    const state = {
      ...baseState,
      directions: baseState.directions.map((direction, index) => ({
        ...direction,
        formatBeats:
          direction.service === "album-post"
            ? ["ปัญหาที่คนมองข้าม", "สิ่งที่ควรเปรียบเทียบ", "ทางเลือกที่นำไปใช้ได้"]
            : direction.service === "ugc-video"
              ? ["เปิดด้วยสถานการณ์จริง", "สาธิตให้เห็นผล", "ปิดด้วยทางเลือกของแบรนด์"]
              : [],
        score: index === 0 ? 82 : direction.score,
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
    expect(
      stage.getByRole("region", { name: "Artwork settings" })
    ).toBeTruthy();
    expect(view.container.querySelectorAll(".neo-angle-setting")).toHaveLength(3);
    expect(view.container.querySelectorAll(".neo-angle-settings")).toHaveLength(1);
    expect(stage.getByRole("heading", { name: "Review recommended hooks" })).toBeTruthy();
    expect(stage.getByRole("button", { name: "Let Neo pick" })).toBeTruthy();
    expect(stage.queryByRole("menuitem", { name: /Export PDF/ })).toBeNull();
    expect(
      stage.queryByPlaceholderText("Add direction for the next round (optional)")
    ).toBeNull();
    await user.click(stage.getByRole("button", { name: "More hook actions" }));
    expect(stage.getByRole("menuitem", { name: /Export PDF/ })).toBeTruthy();
    expect(stage.getByRole("menuitem", { name: /Regenerate all/ })).toBeTruthy();
    await user.click(stage.getByRole("menuitem", { name: /Generate more/ }));
    expect(
      stage.getByPlaceholderText("Add direction for the next round (optional)")
    ).toBeTruthy();
    const angleCards = view.container.querySelectorAll(".neo-angle-card");
    expect(angleCards).toHaveLength(state.directions.length);
    expect(angleCards[0]?.querySelector(".neo-angle-badge-row")).toBeTruthy();
    expect(angleCards[0]?.querySelector(".neo-angle-meta-line")?.textContent).toContain(
      "Creative concept · Awareness"
    );
    expect(angleCards[0]?.querySelector(".neo-angle-hook-wrap")).toBeTruthy();
    expect(angleCards[0]?.querySelectorAll(".neo-angle-copy-block")).toHaveLength(3);
    const albumCard = Array.from(angleCards).find((card) =>
      card.textContent?.includes("ALBUM AD")
    );
    const ugcCard = Array.from(angleCards).find((card) =>
      card.textContent?.includes("UGC VIDEO")
    );
    expect(albumCard?.textContent).toContain("Cover hook");
    expect(albumCard?.textContent).toContain("Inside slides · 3 supporting topics");
    expect(albumCard?.textContent).toContain("ปัญหาที่คนมองข้าม");
    expect(ugcCard?.textContent).toContain("Opening hook");
    expect(ugcCard?.textContent).toContain("UGC video flow · 3 beats");
    expect(angleCards[0]?.querySelector(".neo-angle-card-foot")).toBeTruthy();
    expect(within(angleCards[0] as HTMLElement).getByText("82")).toBeTruthy();
    expect(within(angleCards[0] as HTMLElement).getByText("score")).toBeTruthy();
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

  it("groups the Angle export into recommended topics and other options", async () => {
    const user = userEvent.setup();
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
    expect(stage.queryByRole("menuitem", { name: /Export PDF/ })).toBeNull();
    await user.click(stage.getByRole("button", { name: "More hook actions" }));
    expect(stage.getByRole("menuitem", { name: /Export PDF/ })).toBeTruthy();
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
    expect(review.sections[0]?.ideas[1]?.copywriting?.bullets).toEqual([
      "ปัญหาที่คนมองข้าม",
      "สิ่งที่ควรเปรียบเทียบ",
      "ทางเลือกที่นำไปใช้ได้"
    ]);
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

  it("renders UGC as a 9:16 editable phone template instead of generated artwork", () => {
    const state = workflowReducer(buildMixedAngleState(), { type: "create-outputs" });
    const view = render(<StudioStage state={state} dispatch={vi.fn()} />);

    expect(view.container.querySelectorAll(".neo-ugc-template").length).toBeGreaterThan(0);
    expect(within(view.container).getByRole("heading", { name: "9:16 UGC creatives" })).toBeTruthy();
  });

  it("gives every failed Build quality result a next step", async () => {
    const user = userEvent.setup();
    const base = buildCreativeState();
    const first = base.outputs[0];
    if (!first) throw new Error("Expected a creative output fixture.");
    const state = workflowReducer(base, {
      type: "run-qa",
      results: base.outputs.map((output) => ({
        outputId: output.id,
        passed: output.id !== first.id,
        reason: output.id === first.id ? "Increase the headline contrast." : "Ready."
      }))
    });
    const dispatch = vi.fn();
    const view = render(<StudioStage state={state} dispatch={dispatch} />);
    const stage = within(view.container);

    expect(stage.getByRole("button", { name: "Use suggestion" })).toBeTruthy();
    expect(stage.queryByText("Quality check found a fix")).toBeNull();
    await user.click(stage.getByRole("button", { name: "Keep current" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "resolve-qa-output", id: first.id });
  });

  it("presents Internal QC as a role-focused asset review queue", async () => {
    const user = userEvent.setup();
    const state = buildCreativeState();
    const dispatch = vi.fn();
    const view = render(<ApprovalStage state={state} dispatch={dispatch} />);
    const stage = within(view.container);
    const firstOutput = state.outputs[0];
    if (!firstOutput) throw new Error("Expected a creative output fixture.");
    const gdOutputCount = state.outputs.filter(
      (output) => !output.format.toUpperCase().includes("UGC")
    ).length;
    const standardGdOutputCount = state.outputs.filter(
      (output) =>
        !output.format.toUpperCase().includes("UGC") &&
        !output.format.toLowerCase().includes("album")
    ).length;

    expect(view.container.querySelector(".neo-stage-qc")).toBeTruthy();
    expect(
      stage
        .getByRole("progressbar", { name: "Internal QC progress" })
        .getAttribute("aria-valuenow")
    ).toBe("0");
    expect(stage.getByRole("heading", { name: "Assets in GD review" })).toBeTruthy();
    expect(stage.queryByText("1:1 Static")).toBeNull();
    expect(stage.getAllByText("Static").length).toBeGreaterThan(0);
    expect(
      stage.getAllByText("ความสวยงาม องค์ประกอบ และจุดนำสายตา")
    ).toHaveLength(standardGdOutputCount);
    expect(
      stage.getAllByText(
        "ตรวจ Logo, Brand CI, ชื่อแบรนด์/สินค้า และข้อความใน Artwork ให้ถูกต้อง"
      )
    ).toHaveLength(standardGdOutputCount);
    expect(stage.getAllByRole("button", { name: "Approve → CS" })).toHaveLength(
      gdOutputCount
    );
    const firstCard = view.container.querySelector(".neo-qc-focus-card");
    const firstCardContent = firstCard?.querySelector(".neo-qc-focus-content");
    expect(firstCard?.querySelector(".neo-caption-scroll")).toBeTruthy();
    expect(firstCard?.querySelector(".fb-see-more")).toBeNull();
    expect(firstCardContent?.querySelector(".download-action")).toBeTruthy();
    expect(firstCardContent?.querySelector(".upload-inline")).toBeTruthy();
    expect(
      firstCard?.querySelector(".neo-qc-focus-asset .neo-qc-asset-actions")
    ).toBeNull();
    expect(stage.queryByText("Review route")).toBeNull();
    expect(stage.queryByRole("dialog")).toBeNull();
    expect(stage.queryByRole("button", { name: "Reject" })).toBeNull();

    await user.click(stage.getAllByRole("button", { name: "Approve → CS" })[0]!);
    expect(stage.getByRole("dialog", { name: "GD → CS" })).toBeTruthy();
    await user.click(stage.getByRole("button", { name: "Mark ✓ GD approved" }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "review-output",
      id: firstOutput.id,
      role: "graphicDesign",
      decision: "approved",
      comment: ""
    });
    expect(stage.queryByRole("dialog")).toBeNull();

    await user.click(stage.getByRole("tab", { name: /CS Review/i }));

    expect(stage.getByRole("heading", { name: "Assets in CS review" })).toBeTruthy();
    expect(stage.queryByText("9:16 UGC")).toBeNull();
    expect(stage.getAllByText("UGC").length).toBeGreaterThan(0);
    expect(stage.queryByText("Album post")).toBeNull();
    expect(stage.getAllByText("ALBUM").length).toBeGreaterThan(0);
    expect(
      stage.getAllByText("Key Message ชัด และตรง Brief / Objective")
    ).toHaveLength(gdOutputCount);
    expect(
      stage.getAllByText(
        "งานตรง Client Context หรือ Revision Feedback ถ้าเป็นงานแก้"
      )
    ).toHaveLength(gdOutputCount);
    expect(stage.getAllByRole("button", { name: "Approve → PM" })).toHaveLength(
      state.outputs.length
    );
    await user.click(
      stage.getAllByRole("button", { name: "Request design changes" })[0]!
    );
    expect(stage.getByRole("dialog", { name: "Request changes" })).toBeTruthy();
    await user.type(
      stage.getByRole("textbox", { name: "Change instruction" }),
      "Increase product contrast and keep the brand layout."
    );
    await user.click(stage.getByRole("button", { name: "Route changes" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "route-output-changes",
      id: firstOutput.id,
      requestedBy: "clientService",
      targetRole: "graphicDesign",
      comment: "Increase product contrast and keep the brand layout."
    });
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
