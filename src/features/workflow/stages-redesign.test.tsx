import { render, waitFor, within } from "@testing-library/react";
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
  repositoryErrorMessage,
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
  it("preserves structured Supabase queue errors", () => {
    expect(
      repositoryErrorMessage(
        { message: "Client ingestion is already queued or completed." },
        "Could not queue brand setup."
      )
    ).toBe("Client ingestion is already queued or completed.");
  });

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

  it("preselects a Questionnaire Facebook page and includes its Brand Kit evidence", async () => {
    const user = userEvent.setup();
    const state = {
      ...createInitialWorkflowState({
        id: "run-questionnaire-intake",
        now: "2026-07-15T00:00:00.000Z"
      }),
      brandMenuOpen: true
    };
    const brandRepository = new MockBrandRepository();
    const intakeRepository = new MockClientIntakeRepository(brandRepository);
    const createDraftClient = vi.spyOn(
      intakeRepository,
      "createDraftClient"
    );
    const questionnaire = {
      sourceUrl: "https://docs.google.com/client-portal",
      text: "Brand Name: Centre Point Hotels Group. Website: www.centrepoint.com",
      preview: "Brand Name: Centre Point Hotels Group.",
      facebookUrls: [
        "https://www.facebook.com/centrepointhotels"
      ]
    };
    const view = render(
      <BrandProvider
        repository={brandRepository}
        mappingRepository={{
          list: async () => [
            {
              clientId: "Centre Point Group",
              status: "Active",
              serviceStatus: "Active",
              questionnaire
            }
          ]
        }}
      >
        <ClientIntakeProvider repository={intakeRepository}>
          <BrandMemoryProvider repository={new MockBrandMemoryRepository()}>
            <StartStage state={state} dispatch={vi.fn()} />
          </BrandMemoryProvider>
        </ClientIntakeProvider>
      </BrandProvider>
    );
    const stage = within(view.container);

    await user.click(await stage.findByRole("button", { name: "Add to Neo" }));
    expect(
      (
        stage.getByRole("radio", {
        name: /Found in Questionnaire.*centrepointhotels/i
        }) as HTMLInputElement
      ).checked
    ).toBe(true);
    expect(
      (
        stage.getByRole("checkbox", {
          name: /Use Questionnaire as Brand Kit evidence/i
        }) as HTMLInputElement
      ).checked
    ).toBe(true);

    await user.click(stage.getByRole("button", { name: "Add and analyze" }));

    await waitFor(() =>
      expect(createDraftClient).toHaveBeenCalledWith({
        name: "Centre Point Group",
        facebookUrl: "https://www.facebook.com/centrepointhotels",
        questionnaire: {
          sourceUrl: "https://docs.google.com/client-portal",
          text: questionnaire.text
        }
      })
    );
    expect(
      await stage.findByRole("dialog", {
        name: "Centre Point Group is in the queue."
      })
    ).toBeTruthy();
    expect(stage.getByText(/5-10 minutes to analyze the brand/i)).toBeTruthy();
    expect(
      stage.getByText("We will notify you in Notifications")
    ).toBeTruthy();
    expect(
      stage.getByText(/mailbox at the top right when Brand Kit is ready/i)
    ).toBeTruthy();

    await user.click(stage.getByRole("button", { name: "Got it" }));
    expect(
      stage.queryByRole("dialog", {
        name: "Centre Point Group is in the queue."
      })
    ).toBeNull();
  });

  it("shows setup progress before confirming an existing brand was queued", async () => {
    const user = userEvent.setup();
    const draftBrand = {
      ...brands[0]!,
      id: "draft-brand",
      name: "Draft Brand",
      facebookUrl: "https://www.facebook.com/draftbrand",
      ingestionStatus: "draft" as const,
      existsInSystem: true
    };
    const brandRepository = {
      list: async () => [draftBrand],
      getById: async (id: string) => (id === draftBrand.id ? draftBrand : null)
    };
    let resolveQueue: ((value: { jobId: string }) => void) | undefined;
    const queueExistingClient = vi.fn(
      () =>
        new Promise<{ jobId: string }>((resolve) => {
          resolveQueue = resolve;
        })
    );
    const intakeRepository = {
      createDraftClient: vi.fn(),
      queueExistingClient
    };
    const state = {
      ...createInitialWorkflowState({
        id: "run-existing-brand-intake",
        now: "2026-07-15T00:00:00.000Z"
      }),
      brandMenuOpen: true
    };
    const view = render(
      <BrandProvider
        repository={brandRepository}
        mappingRepository={{ list: async () => [] }}
      >
        <ClientIntakeProvider repository={intakeRepository}>
          <BrandMemoryProvider repository={new MockBrandMemoryRepository()}>
            <StartStage state={state} dispatch={vi.fn()} />
          </BrandMemoryProvider>
        </ClientIntakeProvider>
      </BrandProvider>
    );
    const stage = within(view.container);

    await user.click(await stage.findByRole("button", { name: "Set up brand" }));
    await user.click(stage.getByRole("button", { name: "Analyze brand" }));

    expect(
      stage
        .getByRole("button", { name: "Starting analysis..." })
        .hasAttribute("disabled")
    ).toBe(true);
    expect(queueExistingClient).toHaveBeenCalledWith({
      clientId: draftBrand.id,
      facebookUrl: draftBrand.facebookUrl,
      questionnaire: undefined
    });

    resolveQueue?.({ jobId: "job-draft-brand" });

    expect(
      await stage.findByRole("dialog", {
        name: "Draft Brand is in the queue."
      })
    ).toBeTruthy();
  });

  it("confirms a manually added client without exposing backend job details", async () => {
    const user = userEvent.setup();
    const brandRepository = new MockBrandRepository();
    const state = {
      ...createInitialWorkflowState({
        id: "run-manual-brand-intake",
        now: "2026-07-15T00:00:00.000Z"
      }),
      brandMenuOpen: true
    };
    const view = render(
      <BrandProvider
        repository={brandRepository}
        mappingRepository={{ list: async () => [] }}
      >
        <ClientIntakeProvider
          repository={new MockClientIntakeRepository(brandRepository)}
        >
          <BrandMemoryProvider repository={new MockBrandMemoryRepository()}>
            <StartStage state={state} dispatch={vi.fn()} />
          </BrandMemoryProvider>
        </ClientIntakeProvider>
      </BrandProvider>
    );
    const stage = within(view.container);

    await user.click(
      stage.getByRole("button", { name: /^Add new client/i })
    );
    await user.type(stage.getByLabelText("Client name"), "New Client");
    await user.type(
      stage.getByLabelText("Facebook URL"),
      "https://www.facebook.com/newclient"
    );
    await user.click(stage.getByRole("button", { name: "Create client draft" }));

    const dialog = await stage.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", {
        name: "New Client is in the queue."
      })
    ).toBeTruthy();
    expect(stage.queryByText(/Ingestion job/i)).toBeNull();
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

  it("selects an available brand logo as the default artwork reference", async () => {
    const state = buildCreativeState();
    const dispatch = vi.fn();
    const memoryRepository = new MockBrandMemoryRepository();
    vi.spyOn(memoryRepository, "listBrandRules").mockResolvedValue([
      {
        id: "logo-1",
        title: "Logo",
        description: "Primary logo",
        assetUrl: "https://example.com/logo.png"
      }
    ]);

    render(
      <BrandMemoryProvider repository={memoryRepository}>
        <BriefStage state={{ ...state, stage: "brief" }} dispatch={dispatch} />
      </BrandMemoryProvider>
    );

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({
        type: "sync-brand-logo-reference",
        item: {
          id: "library-logo-1",
          url: "https://example.com/logo.png",
          label: "Logo"
        }
      })
    );
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
        score: index === 0 ? 82 : direction.score
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
    expect(stage.getByRole("heading", { name: "Review hooks" })).toBeTruthy();
    expect(stage.queryByRole("button", { name: "Let Neo pick" })).toBeNull();
    expect(stage.getByRole("button", { name: "Export PDF" })).toBeTruthy();
    expect(stage.queryByRole("combobox", { name: "PDF design" })).toBeNull();
    expect(
      stage.getAllByRole("button", { name: "+ Add hook manually" })
    ).toHaveLength(3);
    const generateMoreButtons = stage.getAllByRole("button", {
      name: "Generate more ideas"
    });
    expect(generateMoreButtons).toHaveLength(3);
    expect(
      generateMoreButtons.every(
        (button) =>
          button.classList.contains("secondary") &&
          !button.classList.contains("primary")
      )
    ).toBe(true);
    expect(view.container.querySelectorAll(".neo-angle-group-buttons")).toHaveLength(
      3
    );
    expect(stage.queryByRole("menuitem", { name: /Export PDF/ })).toBeNull();
    expect(
      stage.queryByPlaceholderText("Add direction for the next round (optional)")
    ).toBeNull();
    expect(stage.queryByRole("button", { name: "More hook actions" })).toBeNull();
    expect(stage.queryByRole("menu")).toBeNull();
    const regenerateAllButton = stage.getByRole("button", {
      name: "↻ Regenerate hooks"
    });
    expect(regenerateAllButton).toBeTruthy();
    expect(regenerateAllButton.classList.contains("secondary")).toBe(true);
    expect(stage.queryByRole("menuitem", { name: /Generate more/ })).toBeNull();
    await user.click(regenerateAllButton);
    expect(
      stage.getByRole("dialog", {
        name: `Change the tone across all ${state.directions.length} hooks`
      })
    ).toBeTruthy();
    await user.click(stage.getByRole("button", { name: "Cancel" }));
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
        .getByRole("button", { name: "Edit" })
        .closest(".neo-angle-top-actions")
    ).toBeTruthy();
    expect(
      Array.from(
        angleCards[0]?.querySelectorAll(".neo-angle-card-foot .btn") ?? []
      ).map((button) => button.textContent)
    ).toEqual(["Rewrite hook", "Delete"]);
    expect(stage.getAllByRole("button", { name: "Rewrite hook" })).toHaveLength(
      state.directions.length
    );
    expect(stage.getAllByRole("button", { name: "Delete" })).toHaveLength(
      state.directions.length
    );
    expect(stage.queryByRole("button", { name: "Adjust bold" })).toBeNull();
    expect(stage.queryByRole("combobox", { name: /Export group/ })).toBeNull();

    await user.click(
      within(angleCards[0] as HTMLElement).getByRole("button", {
        name: "Rewrite hook"
      })
    );
    const rewriteDialog = stage.getByRole("dialog", {
      name: "Rewrite this hook"
    });
    expect(rewriteDialog).toBeTruthy();
    expect(within(rewriteDialog).getByText(state.directions[0]!.hook)).toBeTruthy();
    expect(stage.getByLabelText("What should change?")).toBeTruthy();
    await user.click(stage.getByRole("button", { name: "Cancel" }));

    await user.click(
      stage.getAllByRole("button", { name: "+ Add hook manually" })[0]!
    );
    const manualDialog = stage.getByRole("dialog", {
      name: "Add a STATIC AD topic"
    });
    const manual = within(manualDialog);
    await user.type(manual.getByLabelText("Pillar"), "Product proof");
    await user.type(manual.getByLabelText("Hook"), "A manual proof hook");
    await user.type(
      manual.getByLabelText("Sub-headline"),
      "Show the difference clearly"
    );
    await user.type(manual.getByLabelText("CTA"), "See the proof");
    await user.click(manual.getByRole("button", { name: "Add hook" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "add-manual-direction",
      service: "single-static",
      pillar: "Product proof",
      objective: "Awareness",
      hook: "A manual proof hook",
      subheadline: "Show the difference clearly",
      cta: "See the proof"
    });

    vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(
      within(angleCards[0] as HTMLElement).getByRole("button", {
        name: "Delete"
      })
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "delete-direction",
      id: state.directions[0]?.id
    });

    await user.click(
      stage.getByRole("button", { name: "Deselect Idea 1 card" })
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "toggle-direction",
      id: state.directions[0]?.id
    });
  });

  it("hides hook groups for content types with zero required ideas", () => {
    const baseState = buildMixedAngleState();
    const state = {
      ...baseState,
      creativeMix: baseState.creativeMix!.map((item) => ({
        ...item,
        quantity: item.service === "single-static" ? item.quantity : 0
      })),
      directions: baseState.directions.filter(
        (direction) => direction.service === "single-static"
      )
    };
    const view = render(<DirectionsStage state={state} dispatch={vi.fn()} />);
    const stage = within(view.container);
    const headings = Array.from(
      view.container.querySelectorAll(".neo-angle-group-title h3")
    ).map((node) => node.textContent);

    expect(headings).toEqual(["Static hooks"]);
    expect(stage.queryByRole("heading", { name: "Album hooks" })).toBeNull();
    expect(stage.queryByRole("heading", { name: "UGC video hooks" })).toBeNull();
    expect(
      stage.getAllByRole("button", { name: "Generate more ideas" })
    ).toHaveLength(1);
  });

  it("derives Recommended and Option PDF groups from selection and deletion", async () => {
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
    expect(stage.queryByRole("combobox", { name: "PDF design" })).toBeNull();
    expect(buildAngleExportReview(state).sections.map((section) => section.heading)).toEqual([
      "Recommended topics"
    ]);

    const classifiedDirections = state.directions.map((direction, index) => ({
      ...direction,
      selected: index === 0 || index === 3
    }));
    const reorderedState = {
      ...state,
      directions: [
        classifiedDirections[4]!,
        classifiedDirections[3]!,
        classifiedDirections[0]!,
        classifiedDirections[1]!
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
    expect(
      stage.getByRole("heading", { name: `Creative set · ${state.brand?.name}` })
    ).toBeTruthy();
    expect(
      stage.getByRole("heading", { name: "1:1 Static creatives" })
    ).toBeTruthy();
    expect(stage.getAllByText(/Creative \d/)).toHaveLength(state.outputs.length);
    const reviewCards = view.container.querySelectorAll(
      ".neo-build-review-card"
    );
    expect(reviewCards).toHaveLength(state.outputs.length);
    expect(reviewCards[0]?.querySelector(".neo-build-card-head")).toBeTruthy();
    expect(reviewCards[0]?.querySelector(".neo-build-asset-pair")).toBeTruthy();
    expect(reviewCards[0]?.querySelector(".neo-build-caption")).toBeTruthy();
    expect(reviewCards[0]?.querySelector(".neo-build-qa")).toBeNull();
    expect(stage.queryByText("Not checked yet")).toBeNull();
    expect(reviewCards[0]?.querySelector(".neo-build-output-foot")).toBeTruthy();
  });

  it("saves a Build execution to references through the workflow", async () => {
    const user = userEvent.setup();
    const state = buildCreativeState();
    const firstOutput = state.outputs[0];
    if (!firstOutput) throw new Error("Expected a creative output fixture.");
    const dispatch = vi.fn();
    const view = render(<StudioStage state={state} dispatch={dispatch} />);
    const stage = within(view.container);

    await user.click(stage.getAllByRole("button", { name: "Save reference" })[0]!);

    expect(dispatch).toHaveBeenCalledWith({
      type: "save-output-reference",
      id: firstOutput.id
    });
  });

  it("opens Build artwork in a view-only image popup", async () => {
    const user = userEvent.setup();
    const state = buildCreativeState();
    const view = render(<StudioStage state={state} dispatch={vi.fn()} />);
    const stage = within(view.container);

    await user.click(
      stage.getByRole("button", { name: "Open Creative 1 preview" })
    );

    const dialog = stage.getByRole("dialog", { name: "Creative 1 preview" });
    expect(dialog).toBeTruthy();
    expect(within(dialog).queryByText("Regeneration instructions (optional)")).toBeNull();

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(stage.queryByRole("dialog", { name: "Creative 1 preview" })).toBeNull();
  });

  it("saves an edited Build caption through the workflow action", async () => {
    const user = userEvent.setup();
    const state = buildCreativeState();
    const firstOutput = state.outputs[0];
    const firstDirection = state.directions.find(
      (direction) => direction.id === firstOutput?.directionId
    );
    if (!firstOutput || !firstDirection) {
      throw new Error("Expected a creative output and direction fixture.");
    }
    const dispatch = vi.fn();
    const view = render(<StudioStage state={state} dispatch={dispatch} />);
    const stage = within(view.container);
    const captionEditor = stage.getAllByRole("textbox", {
      name: "Edit caption"
    })[0];
    if (!captionEditor) throw new Error("Expected a Build caption editor.");

    await user.clear(captionEditor);
    await user.type(captionEditor, "Updated caption for Build review.");
    await user.click(stage.getAllByRole("button", { name: "Save" })[0]!);

    expect(dispatch).toHaveBeenCalledWith({
      type: "edit-output-direction",
      id: firstOutput.id,
      hook: firstDirection.hook,
      caption: "Updated caption for Build review.",
      formatBeats: firstDirection.formatBeats ?? []
    });
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
    const firstDirection = state.directions.find(
      (direction) => direction.id === firstOutput.directionId
    );
    const gdOutputCount = state.outputs.filter(
      (output) => !output.format.toUpperCase().includes("UGC")
    ).length;
    const ugcOutputCount = state.outputs.filter((output) =>
      output.format.toUpperCase().includes("UGC")
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
    expect(firstCard?.querySelector(".neo-qc-mini-trail")?.textContent).toContain(
      "GD→CS→PM→Client"
    );
    expect(firstCard?.querySelector(".fb-see-more")).toBeNull();
    expect(
      firstCardContent?.querySelector(".download-action")?.textContent
    ).toContain("Download Image");
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

    const approvedState = workflowReducer(state, {
      type: "review-output",
      id: firstOutput.id,
      role: "graphicDesign",
      decision: "approved",
      comment: ""
    });
    view.rerender(
      <ApprovalStage state={approvedState} dispatch={dispatch} />
    );

    expect(view.container.querySelectorAll(".neo-qc-focus-card")).toHaveLength(
      gdOutputCount - 1
    );
    if (firstDirection) {
      expect(stage.queryByRole("heading", { name: firstDirection.hook })).toBeNull();
    }

    await user.click(stage.getByRole("tab", { name: /CS Review/i }));

    expect(stage.getByRole("heading", { name: "Assets in CS review" })).toBeTruthy();
    expect(stage.queryByText("9:16 UGC")).toBeNull();
    expect(stage.getAllByText("UGC").length).toBeGreaterThan(0);
    expect(stage.queryByText("ALBUM")).toBeNull();
    const ugcCard = view.container
      .querySelector(".neo-qc-ugc-ownership")
      ?.closest(".neo-qc-focus-card");
    expect(
      ugcCard?.querySelector(".neo-qc-check-box > b")?.textContent
    ).toBe("CS checks");
    expect(ugcCard?.querySelectorAll(".neo-qc-check-chips span")).toHaveLength(4);
    expect(ugcCard?.querySelector(".neo-qc-check-list")).toBeNull();
    expect(ugcCard?.querySelector(".neo-qc-mini-trail")?.textContent).toContain(
      "CS→PM→Client"
    );
    expect(ugcCard?.querySelector(".neo-qc-mini-trail")?.textContent).not.toContain(
      "GD"
    );
    expect(
      stage.getAllByText("Key Message ชัด และตรง Brief / Objective")
    ).toHaveLength(1);
    expect(
      stage.getAllByText(
        "งานตรง Client Context หรือ Revision Feedback ถ้าเป็นงานแก้"
      )
    ).toHaveLength(1);
    expect(stage.getAllByRole("button", { name: "Approve → PM" })).toHaveLength(
      ugcOutputCount + 1
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
      stage.getByRole("button", { name: "← Back to Internal QC" })
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
