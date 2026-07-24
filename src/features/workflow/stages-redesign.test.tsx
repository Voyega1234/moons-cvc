import { fireEvent, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { brands } from "../../data/mock-brands";
import type { CreativeQualityReport } from "../../domain/quality-check";
import { BrandMemoryProvider } from "../../app/providers/brand-memory-provider";
import { BrandProvider } from "../../app/providers/brand-provider";
import { ClientIntakeProvider } from "../../app/providers/client-intake-provider";
import { MockBrandMemoryRepository } from "../../repositories/brand-memory/mock-brand-memory-repository";
import { MockBrandRepository } from "../../repositories/brands/mock-brand-repository";
import { MockClientIntakeRepository } from "../../repositories/client-intake/mock-client-intake-repository";
import { createInitialWorkflowState, workflowReducer } from "./reducer";
import type { WorkflowAction, WorkflowState } from "./model";
import {
  ApprovalStage,
  BriefStage,
  ClientStage,
  downloadOutputAsset,
  DirectionsStage,
  missingBrandIdentityInputs,
  repositoryErrorMessage,
  StartStage,
  StudioStage
} from "./stages";
import { buildDirectionFixtures } from "./test-fixtures";
import { buildAngleExportReview } from "./angle-content-types";
import {
  buildCreateStageSlidesPptx,
  buildPmApprovedClientSlidesPptx,
  createStageClientSlideItems,
  pmApprovedClientSlideItems
} from "./export-client-slides-pptx";

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

function qualityReport(passed: boolean, score: number): CreativeQualityReport {
  const criterion = (label: string) => ({
    criterion: label,
    passed,
    score,
    detail: passed ? "ตรวจแล้วผ่านเกณฑ์" : "ข้อความบน first frame ยังอ่านไม่ชัด",
    suggestion: passed ? "" : "เพิ่ม contrast และลดจำนวนข้อความ"
  });
  return {
    score,
    summary: passed
      ? "Clear, distinct, and ready for human review."
      : "The idea is strong, but the first frame needs clearer communication.",
    gd: {
      passed,
      score,
      summary: passed ? "GD ผ่านทุกเกณฑ์" : "GD ต้องปรับความชัดของ first frame",
      criteria: [
        criterion("ความสวยงาม องค์ประกอบ และจุดนำสายตา"),
        {
          criterion:
            "ภาพหยุดสายตาและส่งผลต่อแบรนด์อย่างไร? (Stop-scroll & Brand Impact Audit)",
          passed: true,
          score: 90,
          detail:
            "Stop-scroll verdict: Strong; Brand perception: Positive เพราะ visual hook ชัดและดูน่าเชื่อถือ",
          suggestion: ""
        },
        {
          criterion: "งานนี้ดูออกว่าทำจาก AI หรือไม่? (AI-origin Audit)",
          passed: true,
          score: 92,
          detail:
            "AI-origin verdict: Not obviously AI-generated เพราะแสง เงา และขอบวัตถุต่อเนื่องกัน",
          suggestion: ""
        }
      ]
    },
    cs: {
      passed,
      score,
      summary: passed ? "CS ผ่านทุกเกณฑ์" : "CS ต้องทำ Key Message ให้ชัดขึ้น",
      criteria: [criterion("Key Message ชัด และตรง Brief / Objective")]
    },
    suggestion: passed
      ? { title: "", detail: "", suggestedHook: "" }
      : {
          title: "Tighten the first-frame hook",
          detail: "Communicate the benefit faster with less interpretation.",
          suggestedHook: "Premium features. The difference is visible in one glance."
        }
  };
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
    const baseState = buildCreativeState();
    const state = {
      ...baseState,
      brand: baseState.brand
        ? {
            ...baseState.brand,
            category: "Product/Service questionnaire content that should not appear as the client subtitle",
            ingestionStatus: "ready" as const,
            library: {
              ...baseState.brand.library,
              docs: []
            },
            memory: {
              working: [
                "UGC testimonial hooks beat studio polish",
                "Lead with the business problem",
                "Show the product early",
                "Use a direct CTA\nSource: brand_analysis_jobs/job-789 · 12 images"
              ],
              avoid: [
                "Avoid vague lifestyle claims",
                "Avoid crowded layouts\nSource: brand_analysis_jobs/job-789 · 12 images"
              ]
            }
          }
        : null
    };
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
        id: "brand-details",
        title: "แบรนด์ทำอะไร",
        description:
          "Performance marketing agency, Creative strategy, Full-funnel planning Source: brand_analysis_jobs/job-789 · 12 images"
      },
      {
        id: "target-audience",
        title: "กลุ่มเป้าหมายและปัญหาที่ต้องการแก้",
        description: "B2B brands, Unclear funnel, Low-quality leads"
      },
      {
        id: "usp",
        title: "จุดยืน จุดแตกต่าง และคุณค่าหลัก",
        description: "Quality leads, Integrated strategy, Measurable outcomes"
      },
      {
        id: "mood-tone",
        title: "น้ำเสียงและแนวทางการสื่อสาร",
        description: "Direct, Expert, Minimal"
      }
    ]);
    vi.spyOn(memoryRepository, "listProducts").mockResolvedValue(
      ["Posture support", "Standing desk", "Ergonomic chair", "Foot rest"].map(
        (name, index) => ({
          id: `product-${index}`,
          clientId: state.brand?.id ?? "brand",
          name,
          description: `${name} description`,
          offer: "",
          keyBenefit: `${name} benefit`,
          audience: "Office workers",
          claimNotes: "",
          price: "",
          landingUrl: "",
          isActive: true,
          sortOrder: index
        })
      )
    );
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

    expect(view.container.querySelector(".compass-signal-stage")).toBeTruthy();
    expect(stage.getByText("01 / Signal")).toBeTruthy();
    expect(stage.getByText("Brand workspace")).toBeTruthy();
    expect(stage.getByText("Brand materials")).toBeTruthy();
    expect(stage.getByText(`${state.brand?.name} memory`)).toBeTruthy();
    const memoryNavigation = stage.getByRole("navigation", {
      name: "Brand memory sections"
    });
    expect(
      within(memoryNavigation)
        .getAllByRole("button")
        .map((button) => button.textContent)
    ).toEqual(["Brand system", "Product truths", "Creative learnings"]);
    expect(stage.getByText("Signal before output")).toBeTruthy();
    expect(stage.getByRole("button", { name: "Continue to brief →" })).toBeTruthy();
    expect(
      view.container.querySelector(
        ".compass-brand-select-card .select-btn small"
      )?.textContent
    ).toBe("Brand memory ready");
    await waitFor(() =>
      expect(
        view.container.querySelectorAll(
          ".compass-brand-snapshot-colors span"
        )
      ).toHaveLength(4)
    );
    expect(view.container.querySelector(".compass-brand-snapshot-logo")).toBeTruthy();
    expect(
      view.container.querySelectorAll(".compass-brand-snapshot-list article")
        .length
    ).toBe(4);
    expect(
      Array.from(
        view.container.querySelectorAll(".compass-brand-snapshot-list article b")
      ).map((item) => item.textContent)
    ).toEqual(["Brand Details", "Target Audience", "USP", "Mood&Tone"]);
    expect(
      view.container.querySelector(".compass-brand-snapshot-list")?.className
    ).toContain("is-full");
    expect(view.container.querySelector(".compass-brand-snapshot-tags")).toBeNull();
    expect(
      view.container.querySelector(".compass-brand-snapshot-list")?.textContent
    ).not.toContain("brand_analysis_jobs");
    fireEvent.click(stage.getByRole("button", { name: "Product truths" }));
    expect(stage.getByText("Posture support")).toBeTruthy();
    expect(
      view.container.querySelectorAll(".compass-brand-snapshot-list article")
    ).toHaveLength(4);
    fireEvent.click(stage.getByRole("button", { name: "Creative learnings" }));
    expect(stage.getByText("UGC testimonial hooks beat studio polish")).toBeTruthy();
    expect(
      view.container.querySelectorAll(".compass-brand-learning-group")
    ).toHaveLength(2);
    expect(
      view.container.querySelectorAll(".compass-brand-learning-group.working li")
    ).toHaveLength(4);
    expect(
      view.container.querySelectorAll(".compass-brand-learning-group.avoid li")
    ).toHaveLength(2);
    expect(
      view.container.querySelector(".compass-brand-snapshot-list")?.className
    ).toContain("is-full");
    expect(
      view.container.querySelector(".compass-brand-snapshot-list")?.textContent
    ).not.toContain("Source:");
    expect(stage.queryByRole("button", { name: "See more brand memory" })).toBeNull();
    expect(stage.queryByRole("alert")).toBeNull();

    fireEvent.click(stage.getByRole("button", { name: "Manage library" }));
    const libraryDialog = stage.getByRole("dialog", {
      name: "Manage brand materials"
    });
    expect(libraryDialog).toBeTruthy();
    expect(
      stage.getByRole("navigation", { name: "Brand library folders" })
    ).toBeTruthy();
    expect(within(libraryDialog).queryByText("Upload guideline")).toBeNull();
    expect(within(libraryDialog).queryByText("Paste guideline text")).toBeNull();
    fireEvent.click(
      within(libraryDialog).getByRole("button", { name: "Add guideline" })
    );
    expect(
      stage.getByRole("dialog", { name: "Add brand guideline" })
    ).toBeTruthy();
    fireEvent.click(
      stage.getByRole("button", { name: "Close guideline upload" })
    );
    fireEvent.click(
      stage.getByRole("button", { name: "Close brand library" })
    );
    expect(stage.queryByRole("dialog", { name: "Manage brand materials" })).toBeNull();
  });

  it("adds an onboarding questionnaire later from Brand materials", async () => {
    const user = userEvent.setup();
    const state = buildCreativeState();
    const brandRepository = new MockBrandRepository();
    const memoryRepository = new MockBrandMemoryRepository();
    const saveQuestionnaire = vi.spyOn(
      memoryRepository,
      "saveOnboardingQuestionnaire"
    );
    const questionnaireUrl =
      "https://docs.google.com/spreadsheets/d/questionnaire-sheet/edit?gid=577277204#gid=577277204";
    const questionnaireText =
      "Question\tAnswer\nPrimary audience\tUrban professionals";
    const dispatch = vi.fn();

    const view = render(
      <BrandProvider
        repository={brandRepository}
        mappingRepository={{
          list: async () => [],
          readQuestionnaire: async (sourceUrl) => ({
            sourceUrl,
            text: questionnaireText,
            preview: questionnaireText,
            facebookUrls: []
          })
        }}
      >
        <ClientIntakeProvider
          repository={new MockClientIntakeRepository(brandRepository)}
        >
          <BrandMemoryProvider repository={memoryRepository}>
            <StartStage
              state={{ ...state, stage: "start" }}
              dispatch={dispatch}
            />
          </BrandMemoryProvider>
        </ClientIntakeProvider>
      </BrandProvider>
    );
    const stage = within(view.container);
    const questionnaireRow = stage
      .getByText("Questionnaire", { exact: true })
      .closest(".compass-material-compact-row");
    if (!(questionnaireRow instanceof HTMLElement)) {
      throw new Error("Questionnaire material row is missing.");
    }

    await user.click(
      within(questionnaireRow).getByRole("button", { name: "Add" })
    );
    const dialog = stage.getByRole("dialog", {
      name: "Manage brand materials"
    });
    expect(
      within(dialog).getByText(
        "Onboarding-only historical context for Brand Memory and Hook Agent. This is not the brief for the current campaign."
      )
    ).toBeTruthy();

    await user.type(
      within(dialog).getByRole("textbox", {
        name: "Questionnaire Google Sheet URL"
      }),
      questionnaireUrl
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Import questionnaire" })
    );

    await waitFor(() =>
      expect(saveQuestionnaire).toHaveBeenCalledWith({
        clientId: state.brand?.id,
        text: questionnaireText,
        sourceUrl: questionnaireUrl
      })
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "sync-onboarding-questionnaire",
      questionnaire: {
        sourceUrl: questionnaireUrl,
        text: questionnaireText,
        preview: questionnaireText,
        facebookUrls: []
      }
    });
    expect(
      within(dialog).getByText("Used in Hook Agent context")
    ).toBeTruthy();
  });

  it("uploads a reference from Manage brand materials and syncs the library", async () => {
    const user = userEvent.setup();
    const state = buildCreativeState();
    const brandRepository = new MockBrandRepository();
    const memoryRepository = new MockBrandMemoryRepository();
    const createReferenceImage = vi.spyOn(
      memoryRepository,
      "createReferenceImage"
    );
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn().mockReturnValue("blob:brand-reference")
    });
    const dispatch = vi.fn();

    const view = render(
      <BrandProvider
        repository={brandRepository}
        mappingRepository={{ list: async () => [] }}
      >
        <ClientIntakeProvider
          repository={new MockClientIntakeRepository(brandRepository)}
        >
          <BrandMemoryProvider repository={memoryRepository}>
            <StartStage
              state={{ ...state, stage: "start" }}
              dispatch={dispatch}
            />
          </BrandMemoryProvider>
        </ClientIntakeProvider>
      </BrandProvider>
    );
    const stage = within(view.container);

    await user.click(stage.getByRole("button", { name: "Manage library" }));
    const dialog = stage.getByRole("dialog", {
      name: "Manage brand materials"
    });
    await user.click(
      within(dialog).getByRole("button", { name: /References/ })
    );

    const file = new File(["image"], "approved-moodboard.png", {
      type: "image/png"
    });
    await user.upload(
      within(dialog).getByLabelText("Upload reference"),
      file
    );

    await waitFor(() =>
      expect(createReferenceImage).toHaveBeenCalledWith({
        clientId: state.brand?.id,
        file
      })
    );
    expect(
      within(dialog).getByRole("img", { name: "approved-moodboard.png" })
    ).toBeTruthy();
    expect(dispatch).toHaveBeenCalledWith({
      type: "sync-brand-references",
      items: [
        expect.objectContaining({
          title: "approved-moodboard.png",
          assetUrl: "blob:brand-reference"
        }),
        ...(state.brand?.library.refs ?? [])
      ]
    });
  });

  it("adds a guideline from the Memory header through file or pasted text", async () => {
    const user = userEvent.setup();
    const state = buildCreativeState();
    const brandRepository = new MockBrandRepository();
    const memoryRepository = new MockBrandMemoryRepository();
    const analyzeGuideline = vi.spyOn(memoryRepository, "analyzeGuideline");
    const dispatch = vi.fn();

    const view = render(
      <BrandProvider
        repository={brandRepository}
        mappingRepository={{ list: async () => [] }}
      >
        <ClientIntakeProvider
          repository={new MockClientIntakeRepository(brandRepository)}
        >
          <BrandMemoryProvider repository={memoryRepository}>
            <StartStage
              state={{ ...state, stage: "start" }}
              dispatch={dispatch}
            />
          </BrandMemoryProvider>
        </ClientIntakeProvider>
      </BrandProvider>
    );
    const stage = within(view.container);

    await user.click(stage.getByRole("button", { name: "Add guideline" }));
    const dialog = stage.getByRole("dialog", { name: "Add brand guideline" });
    expect(within(dialog).getByText("Upload file")).toBeTruthy();
    expect(
      dialog.querySelector(
        'input[type="file"][accept="application/pdf,image/png,image/jpeg,image/webp"]'
      )
    ).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: /Paste text/ }));
    await user.type(
      within(dialog).getByRole("textbox", { name: "Guideline text" }),
      "Use a direct, premium voice with #101828 and #FFFFFF."
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Analyze text" })
    );

    await waitFor(() =>
      expect(
        stage.queryByRole("dialog", { name: "Add brand guideline" })
      ).toBeNull()
    );
    expect(analyzeGuideline).toHaveBeenCalledWith({
      clientId: state.brand?.id,
      text: "Use a direct, premium voice with #101828 and #FFFFFF."
    });
    expect(
      stage.getByText(
        "โทนสงบ หรูหรา ใช้ตัวอักษร sans-serif เรียบง่ายและเว้นพื้นที่ว่างมาก"
      )
    ).toBeTruthy();
    expect(await memoryRepository.listBrandRules(state.brand!.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Brand CI / Guideline",
          description: expect.stringContaining("Typography: ใช้ sans-serif")
        })
      ])
    );
    expect(await memoryRepository.listGuidelines(state.brand!.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Brand guideline",
          description: "Use a direct, premium voice with #101828 and #FFFFFF."
        })
      ])
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "sync-brand-rules" })
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "sync-brand-guidelines" })
    );
  });

  it("edits the pasted guideline source from the Guideline folder", async () => {
    const user = userEvent.setup();
    const baseState = buildCreativeState();
    const brandRepository = new MockBrandRepository();
    const memoryRepository = new MockBrandMemoryRepository();
    const clientId = baseState.brand!.id;
    const guideline = await memoryRepository.createGuideline({
      clientId,
      title: "Brand guideline",
      description: "Original guideline source."
    });
    const state = {
      ...baseState,
      brand: {
        ...baseState.brand!,
        library: {
          ...baseState.brand!.library,
          docs: [guideline]
        }
      }
    };
    const dispatch = vi.fn();

    const view = render(
      <BrandProvider
        repository={brandRepository}
        mappingRepository={{ list: async () => [] }}
      >
        <ClientIntakeProvider
          repository={new MockClientIntakeRepository(brandRepository)}
        >
          <BrandMemoryProvider repository={memoryRepository}>
            <StartStage
              state={{ ...state, stage: "start" }}
              dispatch={dispatch}
            />
          </BrandMemoryProvider>
        </ClientIntakeProvider>
      </BrandProvider>
    );
    const stage = within(view.container);

    await user.click(stage.getByRole("button", { name: "Manage library" }));
    const dialog = stage.getByRole("dialog", { name: "Manage brand materials" });
    await user.click(
      within(dialog).getByRole("button", { name: /Guideline/ })
    );
    await user.click(within(dialog).getByRole("button", { name: "Edit" }));
    const editDialog = within(document.body).getByRole("dialog", {
      name: "Edit guideline"
    });
    expect(
      within(dialog).queryByRole("textbox", { name: "Guideline text" })
    ).toBeNull();
    const editor = within(editDialog).getByRole("textbox", {
      name: "Guideline text"
    });
    await user.clear(editor);
    await user.type(editor, "Latest editable guideline source.");
    await user.click(
      within(editDialog).getByRole("button", { name: "Save guideline" })
    );

    await waitFor(async () => {
      expect(await memoryRepository.listGuidelines(clientId)).toEqual([
        expect.objectContaining({
          title: "Brand guideline",
          description: "Latest editable guideline source."
        })
      ]);
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "sync-brand-guidelines",
      items: [
        expect.objectContaining({
          description: "Latest editable guideline source."
        })
      ]
    });
  });

  it("creates an editable Guideline copy for brands with legacy Brand CI only", async () => {
    const user = userEvent.setup();
    const baseState = buildCreativeState();
    const state = {
      ...baseState,
      brand: {
        ...baseState.brand!,
        library: {
          ...baseState.brand!.library,
          brand: baseState.brand!.library.brand.filter(
            (item) => item.title !== "Brand CI / Guideline"
          ),
          docs: []
        }
      }
    };
    const brandRepository = new MockBrandRepository();
    const memoryRepository = new MockBrandMemoryRepository();
    await memoryRepository.createBrandRule({
      clientId: state.brand.id,
      title: "Brand CI / Guideline",
      description: "Legacy extracted guideline available for editing."
    });
    const dispatch = vi.fn();

    const view = render(
      <BrandProvider
        repository={brandRepository}
        mappingRepository={{ list: async () => [] }}
      >
        <ClientIntakeProvider
          repository={new MockClientIntakeRepository(brandRepository)}
        >
          <BrandMemoryProvider repository={memoryRepository}>
            <StartStage
              state={{ ...state, stage: "start" }}
              dispatch={dispatch}
            />
          </BrandMemoryProvider>
        </ClientIntakeProvider>
      </BrandProvider>
    );
    const stage = within(view.container);

    await user.click(stage.getByRole("button", { name: "Manage library" }));
    const dialog = stage.getByRole("dialog", { name: "Manage brand materials" });
    await user.click(
      within(dialog).getByRole("button", { name: /Guideline/ })
    );

    expect(
      await within(dialog).findByText(
        "Legacy extracted guideline available for editing."
      )
    ).toBeTruthy();
    expect(
      await memoryRepository.listGuidelines(state.brand.id)
    ).toEqual([
      expect.objectContaining({
        title: "Brand guideline",
        description: "Legacy extracted guideline available for editing."
      })
    ]);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "sync-brand-guidelines" })
    );
  });

  it('loads onboarding context from the read-only "1. Questionnaire" tab', async () => {
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
    const questionnaire =
      "Brand Name: Centre Point Hotels Group. Website: www.centrepoint.com";
    const questionnaireUrl =
      "https://docs.google.com/spreadsheets/d/client-portal/edit?gid=577277204#gid=577277204";
    const view = render(
      <BrandProvider
        repository={brandRepository}
        mappingRepository={{
          list: async () => [
            {
              clientId: "Centre Point Group",
              status: "Active",
              serviceStatus: "Active",
              clientPortalUrl: questionnaireUrl
            }
          ],
          readQuestionnaire: async (sourceUrl) => ({
            sourceUrl,
            text: questionnaire,
            preview: questionnaire,
            facebookUrls: []
          })
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

    await user.click(
      await stage.findByRole("button", { name: "Add to Creative Compass" })
    );
    expect(stage.getByText("Google Sheet extraction")).toBeTruthy();
    expect(stage.getByText(questionnaireUrl)).toBeTruthy();
    const questionnaireField = stage.getByLabelText(
      "Questionnaire Google Sheet URL"
    ) as HTMLInputElement;
    expect(questionnaireField.value).toBe(questionnaireUrl);
    await user.type(
      stage.getByLabelText("Facebook URL"),
      "https://www.facebook.com/centrepointhotels"
    );

    await user.click(stage.getByRole("button", { name: "Add and analyze" }));

    await waitFor(() =>
      expect(createDraftClient).toHaveBeenCalledWith({
        name: "Centre Point Group",
        facebookUrl: "https://www.facebook.com/centrepointhotels",
        questionnaire: {
          text: questionnaire,
          sourceUrl: questionnaireUrl
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
    const questionnaireUrl =
      "https://docs.google.com/spreadsheets/d/draft-brand-questionnaire/edit?gid=577277204";
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
        mappingRepository={{
          list: async () => [],
          readQuestionnaire: async (sourceUrl) => ({
            sourceUrl,
            text: "Draft Brand onboarding context.",
            preview: "Draft Brand onboarding context.",
            facebookUrls: []
          })
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

    await user.click(await stage.findByRole("button", { name: "Set up brand" }));
    await user.type(
      stage.getByLabelText("Questionnaire Google Sheet URL"),
      questionnaireUrl
    );
    await user.click(stage.getByRole("button", { name: "Analyze brand" }));

    expect(
      stage
        .getByRole("button", { name: "Starting analysis..." })
        .hasAttribute("disabled")
    ).toBe(true);
    expect(queueExistingClient).toHaveBeenCalledWith({
      clientId: draftBrand.id,
      facebookUrl: draftBrand.facebookUrl,
      questionnaire: {
        text: "Draft Brand onboarding context.",
        sourceUrl: questionnaireUrl
      }
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
    const questionnaireUrl =
      "https://docs.google.com/spreadsheets/d/new-client-questionnaire/edit?gid=577277204";
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
        mappingRepository={{
          list: async () => [],
          readQuestionnaire: async (sourceUrl) => ({
            sourceUrl,
            text: "New Client onboarding context.",
            preview: "New Client onboarding context.",
            facebookUrls: []
          })
        }}
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
    await user.type(
      stage.getByLabelText("Questionnaire Google Sheet URL"),
      questionnaireUrl
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
    const memoryRepository = new MockBrandMemoryRepository();
    const uploadedReference = {
      id: "uploaded-reference",
      title: "Uploaded reference.png",
      description: "",
      assetUrl: "https://assets.example.com/uploaded-reference.png"
    };
    const createReferenceImage = vi
      .spyOn(memoryRepository, "createReferenceImage")
      .mockResolvedValue(uploadedReference);
    const view = render(
      <BrandMemoryProvider repository={memoryRepository}>
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
    expect(stage.getByRole("heading", { name: "Brief materials" })).toBeTruthy();
    expect(
      stage.getByRole("heading", { name: "Primary success metric" })
    ).toBeTruthy();
    const productTruthOptions = stage.getAllByRole("checkbox", {
      name: /Use product/
    }) as HTMLInputElement[];
    expect(productTruthOptions).toHaveLength(
      state.brand?.library.products.length ?? 0
    );
    expect(productTruthOptions.every((option) => option.checked)).toBe(true);
    const productTruth = stage
      .getByText("Product truth")
      .closest("details");
    const firstProductDescription =
      state.brand?.library.products[0]?.description;
    if (!productTruth || !firstProductDescription) {
      throw new Error("Expected Product truth fixture.");
    }
    expect((productTruth as HTMLDetailsElement).open).toBe(true);
    expect(
      within(productTruth).queryByText(firstProductDescription)
    ).toBeNull();
    const referenceContext = stage
      .getByText("Reference context")
      .closest("details");
    const materialsContext = stage
      .getByRole("button", { name: "Add Materials" })
      .closest(".compass-signal-disclosure-wrap")
      ?.querySelector("details");
    expect((referenceContext as HTMLDetailsElement | null)?.open).toBe(true);
    expect((materialsContext as HTMLDetailsElement | null)?.open).toBe(false);
    expect(
      stage.getByRole("button", { name: "Add Product truth" })
    ).toBeTruthy();
    expect(
      stage.getByRole("button", { name: "Add Reference" })
    ).toBeTruthy();
    expect(
      stage.getByRole("button", { name: "Add Materials" })
    ).toBeTruthy();
    expect(
      stage.getByRole("button", { name: /CTR/i }).getAttribute("aria-pressed")
    ).toBe("false");
    expect(
      stage.getByRole("button", { name: /CVR/i }).getAttribute("aria-pressed")
    ).toBe("true");
    expect(stage.queryByRole("alert")).toBeNull();
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
    expect(state.albumFormat).toBe("auto");
    expect(
      stage.queryByRole("button", {
        name: "Automatically choose the best album format for each idea"
      })
    ).toBeNull();
    expect(
      stage.queryByRole("button", { name: "4 images · Grid" })
    ).toBeNull();
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

    const firstProduct = state.brand?.library.products[0];
    if (!firstProduct) throw new Error("Expected a product fixture.");
    await user.click(
      stage.getByRole("checkbox", {
        name: `Use product ${firstProduct.title}`
      })
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "toggle-product-context",
      id: firstProduct.id
    });

    await user.click(
      stage.getByRole("button", { name: "Add Product truth" })
    );
    let materialsDialog = stage.getByRole("dialog", {
      name: "Brief materials"
    });
    expect(
      within(materialsDialog)
        .getByRole("button", { name: "Product truth" })
        .getAttribute("aria-expanded")
    ).toBe("true");
    await user.click(
      stage.getByRole("button", { name: "Close brief materials" })
    );

    await user.click(stage.getByRole("button", { name: "Add Reference" }));
    materialsDialog = stage.getByRole("dialog", {
      name: "Brief materials"
    });
    expect(
      within(materialsDialog)
        .getByRole("button", { name: "Reference board" })
        .getAttribute("aria-expanded")
    ).toBe("true");
    await user.click(
      stage.getByRole("button", { name: "Close brief materials" })
    );

    await user.click(stage.getByRole("button", { name: "Add Materials" }));
    materialsDialog = stage.getByRole("dialog", { name: "Brief materials" });
    expect(
      within(materialsDialog)
        .getByRole("button", { name: "Materials" })
        .getAttribute("aria-expanded")
    ).toBe("true");
    await user.click(
      stage.getByRole("button", { name: "Close brief materials" })
    );

    expect(
      stage.queryByRole("button", { name: "Manage brief materials" })
    ).toBeNull();
    await user.click(stage.getByRole("button", { name: "Add Reference" }));
    materialsDialog = stage.getByRole("dialog", {
      name: "Brief materials"
    });
    expect(materialsDialog).toBeTruthy();
    expect(
      within(materialsDialog).getByRole("heading", { name: "Use from library" })
    ).toBeTruthy();
    expect(
      within(materialsDialog).getByRole("button", { name: "Materials" })
    ).toBeTruthy();
    const referenceFile = new File(["reference"], "Uploaded reference.png", {
      type: "image/png"
    });
    await user.upload(
      within(materialsDialog).getByLabelText("Upload reference"),
      referenceFile
    );
    await waitFor(() =>
      expect(createReferenceImage).toHaveBeenCalledWith({
        clientId: state.brand?.id,
        file: referenceFile
      })
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "sync-brand-references",
      items: [uploadedReference, ...(state.brand?.library.refs ?? [])]
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "toggle-reference-image",
      item: {
        id: "library-uploaded-reference",
        url: uploadedReference.assetUrl,
        label: uploadedReference.title,
        role: "style"
      }
    });
    expect(
      within(materialsDialog).getByRole("heading", {
        name: "References in Brief materials"
      })
    ).toBeTruthy();
    expect(
      within(materialsDialog).getByRole("heading", { name: "Materials" })
    ).toBeTruthy();
    expect(
      within(materialsDialog).getByText(
        "Upload the exact products, people, or objects you want used in the artwork."
      )
    ).toBeTruthy();
    expect(
      within(materialsDialog).queryByRole("button", {
        name: "Product materials"
      })
    ).toBeNull();
    await user.click(
      stage.getByRole("button", { name: "Close brief materials" })
    );
    expect(
      stage.queryByRole("dialog", { name: "Brief materials" })
    ).toBeNull();
  });

  it("links extracted guideline tone and colors into brand identity readiness", () => {
    expect(missingBrandIdentityInputs([], [], [])).toEqual([
      "Logo",
      "Brand CI / Guideline",
      "Colors"
    ]);
    expect(
      missingBrandIdentityInputs(
        [
          {
            id: "logo",
            title: "Logo",
            description: "Primary mark",
            assetUrl: "https://example.com/logo.png"
          },
          {
            id: "tone",
            title: "Tone & Style",
            description: "Direct and premium"
          },
          {
            id: "colors",
            title: "Colors",
            description: "#112233, #FFFFFF"
          }
        ],
        [],
        []
      )
    ).toEqual([]);
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

    expect(view.container.querySelector(".compass-stage-angles")).toBeTruthy();
    expect(
      stage.getByRole("region", { name: "Artwork settings" })
    ).toBeTruthy();
    expect(view.container.querySelectorAll(".compass-angle-setting")).toHaveLength(3);
    expect(view.container.querySelectorAll(".compass-angle-settings")).toHaveLength(1);
    expect(stage.getByRole("heading", { name: "Review hooks" })).toBeTruthy();
    expect(stage.queryByRole("button", { name: "Let Compass pick" })).toBeNull();
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
    expect(view.container.querySelectorAll(".compass-angle-group-buttons")).toHaveLength(
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
    const angleCards = view.container.querySelectorAll(".compass-angle-card");
    expect(angleCards).toHaveLength(state.directions.length);
    expect(angleCards[0]?.querySelector(".compass-angle-badge-row")).toBeTruthy();
    expect(angleCards[0]?.querySelector(".compass-angle-meta-line")?.textContent).toContain(
      "Creative concept · Conversion"
    );
    expect(angleCards[0]?.querySelector(".compass-angle-hook-wrap")).toBeTruthy();
    expect(angleCards[0]?.querySelectorAll(".compass-angle-copy-block")).toHaveLength(3);
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
    expect(angleCards[0]?.querySelector(".compass-angle-card-foot")).toBeTruthy();
    expect(within(angleCards[0] as HTMLElement).getByText("82")).toBeTruthy();
    expect(within(angleCards[0] as HTMLElement).getByText("score")).toBeTruthy();
    expect(within(angleCards[0] as HTMLElement).getByText("Subheadline 1")).toBeTruthy();
    expect(within(angleCards[0] as HTMLElement).getByText("Concept 1")).toBeTruthy();
    expect(stage.getAllByRole("button", { name: /Edit Idea/ })).toHaveLength(
      state.directions.length
    );
    expect(angleCards[0]?.classList.contains("selected")).toBe(true);
    expect(
      within(angleCards[0] as HTMLElement).getByText("Your pick")
    ).toBeTruthy();
    expect(
      within(angleCards[0] as HTMLElement)
        .getByRole("button", { name: "Edit Idea 1" })
        .closest(".compass-angle-top-actions")
    ).toBeTruthy();
    expect(
      within(angleCards[0] as HTMLElement)
        .getByRole("button", { name: "Edit Idea 1" })
        .querySelector("svg")
    ).toBeTruthy();
    expect(
      Array.from(
        angleCards[0]?.querySelectorAll(".compass-angle-card-foot .btn") ?? []
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
      objective: "Conversion",
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
      view.container.querySelectorAll(".compass-angle-group-title h3")
    ).map((node) => node.textContent);

    expect(headings).toEqual(["STATIC"]);
    expect(stage.queryByRole("heading", { name: "ALBUM" })).toBeNull();
    expect(stage.queryByRole("heading", { name: "UGC VIDEO" })).toBeNull();
    expect(
      stage.getAllByRole("button", { name: "Generate more ideas" })
    ).toHaveLength(1);
  });

  it("keeps artwork inputs out of the Angles UI", () => {
    const state = {
      ...buildCreativeState(),
      stage: "directions" as const,
      referenceImages: [
        {
          id: "library-angle-reference-1",
          url: "https://example.com/angle-reference.jpg",
          label: "Approved product lifestyle"
        }
      ]
    };
    const view = render(
      <BrandMemoryProvider repository={new MockBrandMemoryRepository()}>
        <DirectionsStage state={state} dispatch={vi.fn()} />
      </BrandMemoryProvider>
    );
    const stage = within(view.container);

    expect(stage.queryByText("Artwork brief for AI")).toBeNull();
    expect(stage.queryByText("Selected references")).toBeNull();
    expect(stage.queryByText("Approved product lifestyle")).toBeNull();
    expect(stage.queryByRole("button", { name: "+ Upload or choose" })).toBeNull();
  });

  it("derives Recommended and Option PDF groups from selection and deletion", async () => {
    const base = buildMixedAngleState();
    const state = {
      ...base,
      creativeMix: [...base.creativeMix!].reverse()
    };
    const view = render(<DirectionsStage state={state} dispatch={vi.fn()} />);
    const stage = within(view.container);
    const headings = Array.from(
      view.container.querySelectorAll(".compass-angle-group-title h3")
    ).map((node) => node.textContent);

    expect(headings).toEqual(["STATIC", "ALBUM", "UGC VIDEO"]);
    const formatPills = Array.from(
      view.container.querySelectorAll(".compass-angle-format-pill")
    ).map((pill) => pill.textContent);
    expect(formatPills.filter((format) => format === "STATIC AD")).toHaveLength(3);
    expect(formatPills.filter((format) => format === "ALBUM AD")).toHaveLength(1);
    expect(formatPills.filter((format) => format === "UGC VIDEO")).toHaveLength(2);
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
    const base = buildCreativeState();
    const state = { ...base, outputs: [...base.outputs].reverse() };
    const view = render(<StudioStage state={state} dispatch={vi.fn()} />);
    const stage = within(view.container);

    expect(view.container.querySelector(".compass-stage-build")).toBeTruthy();
    expect(
      stage.getByRole("heading", { name: `Creative set · ${state.brand?.name}` })
    ).toBeTruthy();
    expect(
      stage.getByRole("heading", { name: "STATIC" })
    ).toBeTruthy();
    expect(
      Array.from(
        view.container.querySelectorAll(".build-section-head h3")
      ).map((heading) => heading.textContent)
    ).toEqual(["STATIC", "ALBUM", "UGC VIDEO"]);
    expect(stage.getAllByText(/Creative \d/)).toHaveLength(state.outputs.length);
    const reviewCards = view.container.querySelectorAll(
      ".compass-build-review-card"
    );
    expect(reviewCards).toHaveLength(state.outputs.length);
    expect(reviewCards[0]?.querySelector(".compass-build-card-head")).toBeTruthy();
    expect(reviewCards[0]?.querySelector(".compass-build-asset-pair")).toBeTruthy();
    expect(reviewCards[0]?.querySelector(".compass-build-caption")).toBeTruthy();
    expect(reviewCards[0]?.querySelector(".compass-build-qa")).toBeNull();
    expect(stage.queryByText("Not checked yet")).toBeNull();
    expect(reviewCards[0]?.querySelector(".compass-build-output-foot")).toBeTruthy();
    expect(
      stage.getByRole("button", { name: "↻ Regenerate all images" })
    ).toBeTruthy();
    expect(
      stage.getByRole("button", { name: "Open in Google Slides" })
    ).toBeTruthy();
  });

  it("enables Google Slides export for every generated creative", async () => {
    const base = buildCreativeState();
    const state = {
      ...base,
      outputs: base.outputs.map((output) => ({
        ...output,
        assetUrl: `https://example.com/${output.id}.png`
      }))
    };
    const view = render(<StudioStage state={state} dispatch={vi.fn()} />);
    const stage = within(view.container);
    const googleSlidesButton = stage.getByRole("button", {
      name: "Open in Google Slides"
    });

    expect(googleSlidesButton.hasAttribute("disabled")).toBe(false);
    expect(googleSlidesButton.getAttribute("title")).toBe(
      `Create ${createStageClientSlideItems(state).length} creative slides in Google Slides`
    );

    const pptx = await buildCreateStageSlidesPptx(
      state,
      async (url) => `data:image/png;base64,${btoa(url)}`
    );
    expect(
      (
        pptx as unknown as {
          _slides: readonly unknown[];
        }
      )._slides
    ).toHaveLength(createStageClientSlideItems(state).length);
  });

  it("keeps Google Slides export enabled for viewers", () => {
    const base = buildCreativeState();
    const state = {
      ...base,
      outputs: base.outputs.map((output) => ({
        ...output,
        assetUrl: `https://example.com/${output.id}.png`
      }))
    };
    const view = render(
      <StudioStage state={state} dispatch={vi.fn()} canEdit={false} />
    );
    const stage = within(view.container);

    expect(
      stage
        .getByRole("button", { name: "Open in Google Slides" })
        .hasAttribute("disabled")
    ).toBe(false);
    expect(
      stage.getByRole("button", { name: "Open Creative 1 preview" }).matches(":disabled")
    ).toBe(false);
    expect(
      stage.getByRole("button", { name: "↻ Regenerate all images" }).hasAttribute("disabled")
    ).toBe(true);
    expect(
      stage
        .getAllByRole("textbox", { name: "Edit caption" })
        .every((textbox) => textbox.matches(":disabled"))
    ).toBe(true);
  });

  it("uses Sarabun throughout the slide and tags Thai text correctly", async () => {
    const base = buildCreativeState();
    const firstDirection = base.directions[0];
    const firstOutput = base.outputs[0];
    if (!firstDirection || !firstOutput) {
      throw new Error("Expected creative fixtures for Thai slide export.");
    }
    const state = {
      ...base,
      directions: [
        {
          ...firstDirection,
          hook: "เปลี่ยนเตาเมื่อไร กระทะก็ยังไปต่อ",
          concept: "สื่อสารว่ากระทะใบเดียวใช้งานได้กับเตาหลายประเภท",
          cta: "เลือกกระทะที่ใช้ได้ทุกเตา",
          caption: "ใช้งานได้ทั้งเตาแก๊ส เตาไฟฟ้า และเตา Induction"
        }
      ],
      outputs: [
        {
          ...firstOutput,
          directionId: firstDirection.id,
          assetUrl: "https://example.com/thai-creative.png"
        }
      ]
    };

    const pptx = await buildCreateStageSlidesPptx(
      state,
      async () =>
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xz4mAAAAAElFTkSuQmCC"
    );
    const slides = (
      pptx as unknown as {
        _slides: Array<{
          _slideObjects: Array<{
            _type: string;
            text?: Array<{ text: string }>;
            options: { fontFace?: string; lang?: string };
          }>;
        }>;
      }
    )._slides;
    const textObjects = slides.flatMap((slide) =>
      slide._slideObjects.filter(
        (object) => object._type === "text" && Boolean(object.text?.length)
      )
    );
    const thaiTextObjects = textObjects.filter((object) =>
      object.text?.some((run) => /[\u0E00-\u0E7F]/.test(run.text))
    );

    expect(textObjects.length).toBeGreaterThan(0);
    expect(thaiTextObjects.length).toBeGreaterThan(0);
    textObjects.forEach((object) => {
      expect(object.options.fontFace).toBe("Sarabun");
    });
    thaiTextObjects.forEach((object) => {
      expect(object.options).toMatchObject({
        fontFace: "Sarabun",
        lang: "th-TH"
      });
    });
  });

  it("exports UGC in the shared deck theme with a phone reference and three-part script", async () => {
    const base = buildCreativeState();
    const firstDirection = base.directions[0];
    const firstOutput = base.outputs[0];
    if (!firstDirection || !firstOutput) {
      throw new Error("Expected creative fixtures for UGC slide export.");
    }
    const direction = {
      ...firstDirection,
      service: "ugc-video" as const,
      hook: "เช้ารีบแค่ไหน ไข่ข้นก็ยังทัน",
      concept: "Creator สาธิตมื้อเช้าจริงที่ทำได้ก่อนออกจากบ้าน",
      formatBeats: ["เปิดด้วยเวลาที่ใกล้หมด", "สาธิตทำไข่ข้น", "ชิมและปิดด้วย CTA"],
      ugcBrief: {
        product: "Korea King Colormic 24cm",
        duration: "15–30 วินาที",
        objective: "ทำให้คนเห็นว่ากระทะเหมาะกับเมนูเช้าที่ทำได้เร็ว",
        moodAndTone: "สดใส เป็นธรรมชาติ คล่องตัว",
        productionStyle: "Handheld creator POV สลับ close-up อาหาร",
        referenceDirection: "UGC ครัวเช้า แสงธรรมชาติ และ text overlay สั้น",
        openingScript: "เปิดนาฬิกาแล้วพูดว่าเหลือเวลาไม่ถึง 10 นาที",
        showcaseScript: "เทไข่ลงกระทะและถ่าย close-up เนื้อไข่ข้น",
        closingScript: "ยกจานขึ้นชิมแล้วชวนเลือก Colormic 24cm"
      }
    };
    const state = {
      ...base,
      directions: [direction],
      outputs: [
        {
          ...firstOutput,
          directionId: direction.id,
          format: "9:16 UGC",
          assetUrl: undefined
        }
      ],
      referenceImages: [
        {
          id: "ugc-style-reference",
          url: "https://example.com/ugc-reference.png",
          label: "UGC morning kitchen reference",
          role: "style" as const,
          primary: true
        }
      ]
    };

    const pptx = await buildCreateStageSlidesPptx(
      state,
      async () =>
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xz4mAAAAAElFTkSuQmCC"
    );
    const [slide] = (
      pptx as unknown as {
        _slides: Array<{
          _slideObjects: Array<{
            _type: string;
            text?: Array<{ text: string }>;
          }>;
        }>;
      }
    )._slides;
    const visibleText =
      slide?._slideObjects
        .flatMap((object) => object.text?.map((run) => run.text) ?? [])
        .join("\n") ?? "";

    expect(visibleText).toContain("UGC VISUAL REFERENCE");
    expect(visibleText).toContain("Korea King Colormic 24cm");
    expect(visibleText).toContain("15–30 วินาที");
    expect(visibleText).toContain("VIDEO STORYLINE");
    expect(visibleText).toContain("OPEN / HOOK");
    expect(visibleText).toContain("SHOWCASE");
    expect(visibleText).toContain("END / CTA");
    expect(
      slide?._slideObjects.some((object) => object._type === "image")
    ).toBe(true);
  });

  it("groups three album images into one review card and shows standalone previews", async () => {
    const user = userEvent.setup();
    const base = buildCreativeState();
    const sourceOutput = base.outputs[0];
    if (!sourceOutput) throw new Error("Expected a creative output fixture.");
    const state = {
      ...base,
      outputs: [1, 2, 3].map((panel) => ({
        ...sourceOutput,
        id: `${sourceOutput.directionId}-album-${panel}-v1`,
        format: "Album post",
        assetUrl: `https://example.com/album-panel-${panel}.png`
      }))
    };
    const dispatch = vi.fn();
    const view = render(<StudioStage state={state} dispatch={dispatch} />);
    const stage = within(view.container);
    const albumHeading = stage.getByRole("heading", {
      name: "ALBUM"
    });
    const albumSection = albumHeading.closest(".build-type-section");
    if (!(albumSection instanceof HTMLElement)) {
      throw new Error("Expected the album review section.");
    }

    expect(
      albumSection.querySelectorAll(".compass-build-review-card")
    ).toHaveLength(1);
    expect(
      albumSection.querySelectorAll(".compass-album-panels img")
    ).toHaveLength(3);
    expect(
      albumSection.querySelector(".compass-album-panels.compact")
    ).toBeTruthy();
    expect(within(albumSection).getAllByRole("textbox", {
      name: "Edit caption"
    })).toHaveLength(1);
    expect(albumSection.querySelector(".build-section-head strong")?.textContent).toBe(
      "1"
    );

    await user.click(
      within(albumSection).getByRole("button", { name: "Save album" })
    );
    expect(dispatch).toHaveBeenCalledTimes(3);
    state.outputs.forEach((output) => {
      expect(dispatch).toHaveBeenCalledWith({
        type: "save-output-reference",
        id: output.id
      });
    });

    await user.click(
      within(albumSection).getByRole("button", {
        name: "Open album creative 1 preview"
      })
    );

    const dialog = stage.getByRole("dialog", {
      name: "Album creative preview"
    });
    expect(dialog.querySelectorAll(".compass-album-panels img")).toHaveLength(3);
    expect(dialog.querySelector(".compass-album-panels.compact")).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
  });

  it("does not show a fake score for generated artwork before real QA runs", () => {
    const base = buildCreativeState();
    const state = {
      ...base,
      outputs: base.outputs.map((output) => ({
        ...output,
        status: "ready" as const
      }))
    };
    const view = render(<StudioStage state={state} dispatch={vi.fn()} />);
    const stage = within(view.container);
    const reviewCards = view.container.querySelectorAll(
      ".compass-build-review-card"
    );

    expect(reviewCards[0]?.querySelector(".compass-build-qa")).toBeNull();
    expect(stage.queryByText("88")).toBeNull();
    expect(
      stage.queryByText("Clear, distinct, and ready for human review.")
    ).toBeNull();
    expect(stage.getAllByText("AI draft")).toHaveLength(state.outputs.length);
  });

  it("sends unchecked drafts directly to Internal QC", async () => {
    const user = userEvent.setup();
    const state = buildCreativeState();
    const dispatch = vi.fn();
    const view = render(<StudioStage state={state} dispatch={dispatch} />);
    const stage = within(view.container);
    const sendButton = stage.getByRole("button", {
      name: "Send to Internal QC →"
    }) as HTMLButtonElement;

    expect(state.qaComplete).toBe(false);
    expect(sendButton.disabled).toBe(false);
    expect(
      stage.getByRole("button", { name: "Quality check (optional)" })
    ).toBeTruthy();

    await user.click(sendButton);

    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith({
        type: "set-stage",
        stage: "approval"
      });
    });
  });

  it("shows the score and compact review returned by real QA", () => {
    const base = buildCreativeState();
    const state = workflowReducer(base, {
      type: "run-qa",
      results: base.outputs.map((output, index) => ({
        outputId: output.id,
        passed: true,
        reason: "Passed real quality review.",
        report: qualityReport(true, 91 + index)
      }))
    });
    const view = render(<StudioStage state={state} dispatch={vi.fn()} />);
    const firstCard = view.container.querySelector(
      ".compass-build-review-card"
    );

    expect(firstCard?.textContent).toContain("91");
    expect(firstCard?.textContent).toContain(
      "Clear, distinct, and ready for human review."
    );
    expect(
      firstCard?.querySelector(".compass-build-qa-score-grid")
    ).toBeNull();
    expect(firstCard?.textContent).not.toContain("AI-origin");
    expect(firstCard?.textContent).not.toContain("Brand impact");
    expect(firstCard?.textContent).not.toContain("GD Checklist Review");
    expect(firstCard?.textContent).not.toContain("CS Checklist Review");
    expect(firstCard?.textContent).not.toContain("88");
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

    expect(view.container.querySelectorAll(".compass-ugc-template").length).toBeGreaterThan(0);
    expect(within(view.container).getByRole("heading", { name: "UGC VIDEO" })).toBeTruthy();
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
        reason: output.id === first.id ? "Increase the headline contrast." : "Ready.",
        report: qualityReport(output.id !== first.id, output.id === first.id ? 78 : 90)
      }))
    });
    const dispatch = vi.fn();
    const view = render(<StudioStage state={state} dispatch={dispatch} />);
    const stage = within(view.container);

    expect(stage.getByRole("button", { name: "Use suggestion" })).toBeTruthy();
    const failedCard = stage
      .getByRole("button", { name: "Use suggestion" })
      .closest(".compass-build-review-card");
    expect(failedCard?.textContent).toContain("Tighten the first-frame hook");
    expect(failedCard?.textContent).toContain("View 2 priority issues");
    expect(failedCard?.textContent).not.toContain("GD Checklist Review");
    expect(failedCard?.textContent).not.toContain("CS Checklist Review");
    expect(failedCard?.textContent).toContain(
      "Premium features. The difference is visible in one glance."
    );
    expect(failedCard?.textContent).toContain("78");
    expect(failedCard?.textContent).not.toContain("Not obviously AI-generated");
    expect(failedCard?.textContent).not.toContain("Stop-scroll ready");
    expect(failedCard?.textContent).not.toContain("AI-origin");
    expect(failedCard?.textContent).not.toContain("Brand impact");
    expect(stage.queryByText("Quality check found a fix")).toBeNull();
    await user.click(stage.getByRole("button", { name: "Use suggestion" }));
    const regenerateDialog = stage.getByRole("dialog");
    const regenerationInstructions = within(regenerateDialog).getByRole(
      "textbox",
      { name: "Revision instructions" }
    ) as HTMLTextAreaElement;
    expect(regenerationInstructions.value).toContain(
      "Creative review direction:"
    );
    expect(regenerationInstructions.value).toContain(
      "Communicate the benefit faster with less interpretation."
    );
    expect(regenerationInstructions.value).not.toContain("quality score");
    expect(regenerationInstructions.value).not.toContain(
      "Premium features. The difference is visible in one glance."
    );
    expect(within(regenerateDialog).getByText(/improve the full composition/)).toBeTruthy();
    await user.click(
      within(regenerateDialog).getAllByRole("button", { name: "Close" })[0]!
    );
    await user.click(stage.getByRole("button", { name: "Keep current" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "resolve-qa-output", id: first.id });
  });

  it("resolves every hidden album panel when keeping the grouped creative", async () => {
    const user = userEvent.setup();
    const base = buildCreativeState();
    const source = base.outputs[0];
    if (!source) throw new Error("Expected a creative output fixture.");
    const albumOutputs = [1, 2, 3].map((panel) => ({
      ...source,
      id: `album-direction-album-${panel}-v1`,
      directionId: source.directionId,
      format: "Album post",
      status: "needs-revision" as const,
      assetUrl: `https://example.com/album-${panel}.png`,
      qaNote: `Panel ${panel} needs refinement.`,
      qaReport: qualityReport(false, 78)
    }));
    const state = { ...base, qaComplete: true, outputs: albumOutputs };
    const dispatch = vi.fn();
    const view = render(<StudioStage state={state} dispatch={dispatch} />);
    const stage = within(view.container);

    expect(stage.getByText("1 guided improvement to review.")).toBeTruthy();
    expect(stage.getAllByRole("button", { name: "Keep current" })).toHaveLength(1);

    await user.click(stage.getByRole("button", { name: "Keep current" }));

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual(
      albumOutputs.map((output) => ({
        type: "resolve-qa-output",
        id: output.id
      }))
    );
  });

  it("does not count UGC as a guided image improvement", () => {
    const base = buildCreativeState();
    const ugcOutputs = base.outputs.slice(0, 2).map((output, index) => ({
      ...output,
      id: `ugc-${index + 1}`,
      format: "9:16 UGC",
      status: "needs-revision" as const,
      qaNote: "Legacy image-QA note.",
      qaReport: qualityReport(false, 78)
    }));
    const state = { ...base, qaComplete: true, outputs: ugcOutputs };
    const view = render(<StudioStage state={state} dispatch={vi.fn()} />);
    const stage = within(view.container);
    const sendButton = stage.getByRole("button", {
      name: "Send to Internal QC →"
    }) as HTMLButtonElement;

    expect(stage.getByText("Quality check complete.")).toBeTruthy();
    expect(stage.queryByText(/guided improvement.*to review/i)).toBeNull();
    expect(sendButton.disabled).toBe(false);
  });

  it("presents Internal QC as a role-focused asset review queue", async () => {
    const user = userEvent.setup();
    const state = buildCreativeState();
    const dispatch = vi.fn();
    const view = render(
      <BrandMemoryProvider repository={new MockBrandMemoryRepository()}>
        <ApprovalStage state={state} dispatch={dispatch} />
      </BrandMemoryProvider>
    );
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

    expect(view.container.querySelector(".compass-stage-qc")).toBeTruthy();
    expect(
      stage
        .getByRole("progressbar", { name: "Internal QC progress" })
        .getAttribute("aria-valuenow")
    ).toBe("0");
    expect(stage.getByRole("heading", { name: "Assets in GD review" })).toBeTruthy();
    expect(stage.getByRole("button", { name: /Material pack/i })).toBeTruthy();
    expect(
      stage.getByRole("button", { name: `Approve all · ${gdOutputCount}` })
    ).toBeTruthy();
    expect(stage.queryByText("1:1 Static")).toBeNull();
    expect(stage.getAllByText("Static").length).toBeGreaterThan(0);
    expect(
      stage.getAllByText(
        "Visual Quality และ Design Principles ครบถ้วนบนหน้าจอมือถือ"
      )
    ).toHaveLength(standardGdOutputCount);
    expect(
      stage.getAllByText(
        "แสง เงา วัสดุ perspective และ contact shadow สมจริงเป็นระบบเดียวกัน"
      )
    ).toHaveLength(standardGdOutputCount);
    expect(
      stage.getAllByText(
        "ไม่พบร่องรอย AI-generated ที่พิสูจน์ได้ วัตถุไม่ลอยหรือตัดแปะ"
      )
    ).toHaveLength(standardGdOutputCount);
    expect(
      stage.getAllByText(
        "Logo, Brand CI, ชื่อแบรนด์/สินค้า และข้อความใน Artwork ถูกต้อง"
      )
    ).toHaveLength(standardGdOutputCount);
    expect(stage.getAllByRole("button", { name: "Approve → CS" })).toHaveLength(
      gdOutputCount
    );
    const firstCard = view.container.querySelector(".compass-qc-focus-card");
    const firstCardContent = firstCard?.querySelector(".compass-qc-focus-content");
    expect(firstCard?.querySelector(".compass-caption-scroll")).toBeTruthy();
    expect(firstCard?.querySelector(".compass-qc-mini-trail")?.textContent).toContain(
      "GD→CS→PM→Client"
    );
    expect(firstCard?.querySelector(".fb-see-more")).toBeNull();
    expect(
      firstCardContent?.querySelector(".download-action")?.textContent
    ).toContain("Download Image");
    expect(firstCardContent?.querySelector(".upload-inline")).toBeTruthy();
    expect(
      firstCard?.querySelector(".compass-qc-focus-asset .compass-qc-asset-actions")
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
      <BrandMemoryProvider repository={new MockBrandMemoryRepository()}>
        <ApprovalStage state={approvedState} dispatch={dispatch} />
      </BrandMemoryProvider>
    );

    expect(view.container.querySelectorAll(".compass-qc-focus-card")).toHaveLength(
      gdOutputCount - 1
    );
    if (firstDirection) {
      expect(stage.queryByRole("heading", { name: firstDirection.hook })).toBeNull();
    }

    await user.click(stage.getByRole("tab", { name: /CS Review/i }));

    expect(stage.getByRole("heading", { name: "Assets in CS review" })).toBeTruthy();
    expect(stage.queryByRole("button", { name: /Material pack/i })).toBeNull();
    expect(stage.queryByText("9:16 UGC")).toBeNull();
    expect(stage.getAllByText("UGC").length).toBeGreaterThan(0);
    expect(stage.queryByText("ALBUM")).toBeNull();
    const ugcCard = view.container
      .querySelector(".compass-qc-ugc-ownership")
      ?.closest(".compass-qc-focus-card");
    expect(
      ugcCard?.querySelector(".compass-qc-check-box > b")?.textContent
    ).toBe("CS checks");
    expect(ugcCard?.querySelectorAll(".compass-qc-check-chips span")).toHaveLength(4);
    expect(ugcCard?.querySelector(".compass-qc-check-list")).toBeNull();
    expect(ugcCard?.querySelector(".compass-qc-mini-trail")?.textContent).toContain(
      "CS→PM→Client"
    );
    expect(ugcCard?.querySelector(".compass-qc-mini-trail")?.textContent).not.toContain(
      "GD"
    );
    expect(
      stage.getAllByText("Key Message ชัด และตรง Brief / Objective")
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

  it("keeps Internal QC inspection available to viewers without approval controls", async () => {
    const user = userEvent.setup();
    const state = buildCreativeState();
    const dispatch = vi.fn();
    const view = render(
      <BrandMemoryProvider repository={new MockBrandMemoryRepository()}>
        <ApprovalStage state={state} dispatch={dispatch} canEdit={false} />
      </BrandMemoryProvider>
    );
    const stage = within(view.container);

    expect(
      (
        stage.getByRole("button", {
          name: `Approve all · ${state.outputs.filter(
            (output) => !output.format.toUpperCase().includes("UGC")
          ).length}`
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      stage
        .getAllByRole("button", { name: "Approve → CS" })
        .every((button) => (button as HTMLButtonElement).disabled)
    ).toBe(true);

    await user.click(
      stage.getByRole("button", { name: /Open creative 1 preview/i })
    );
    expect(
      stage.getByRole("dialog", { name: "Creative 1 preview" })
    ).toBeTruthy();
    await user.click(stage.getByRole("button", { name: "Close" }));
    expect(stage.queryByRole("dialog")).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("reviews and counts a three-panel album as one QC creative", async () => {
    const user = userEvent.setup();
    const base = buildCreativeState();
    const source = base.outputs[0];
    if (!source) throw new Error("Expected a creative output fixture.");
    const albumOutputs = [1, 2, 3].map((panel) => ({
      ...source,
      id: `${source.directionId}-album-${panel}-v1`,
      format: "Album post",
      status: "ready" as const,
      assetUrl: `https://example.com/album-${panel}.png`
    }));
    const state = { ...base, qaComplete: true, outputs: albumOutputs };
    const dispatch = vi.fn();
    const view = render(
      <BrandMemoryProvider repository={new MockBrandMemoryRepository()}>
        <ApprovalStage state={state} dispatch={dispatch} />
      </BrandMemoryProvider>
    );
    const stage = within(view.container);

    expect(view.container.querySelectorAll(".compass-qc-focus-card")).toHaveLength(1);
    expect(view.container.querySelectorAll(".compass-album-panels img")).toHaveLength(3);
    expect(stage.getByRole("button", { name: "Approve all · 1" })).toBeTruthy();
    expect(stage.getAllByRole("button", { name: "Approve → CS" })).toHaveLength(1);
    expect(
      stage
        .getByRole("progressbar", { name: "Internal QC progress" })
        .getAttribute("aria-valuemax")
    ).toBe("3");

    await user.click(stage.getByRole("button", { name: "Approve → CS" }));
    await user.click(stage.getByRole("button", { name: "Mark ✓ GD approved" }));

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual(
      albumOutputs.map((output) => ({
        type: "review-output",
        id: output.id,
        role: "graphicDesign",
        decision: "approved",
        comment: ""
      }))
    );
  });

  it("offers one client deck from PM Review when approved assets are ready", async () => {
    const user = userEvent.setup();
    const state = buildCreativeState();
    const dispatch = vi.fn();
    const view = render(
      <BrandMemoryProvider repository={new MockBrandMemoryRepository()}>
        <ApprovalStage state={state} dispatch={dispatch} />
      </BrandMemoryProvider>
    );
    const stage = within(view.container);

    await user.click(stage.getByRole("tab", { name: /PM Review/i }));
    const emptyGoogleSlides = stage.getByRole("button", {
      name: "Open in Google Slides · 0"
    }) as HTMLButtonElement;
    expect(emptyGoogleSlides.disabled).toBe(true);
    expect(
      stage.getByText(
        "One Google Slides deck with every PM-approved asset, including UGC."
      )
    ).toBeTruthy();

    const approvedState = workflowReducer(state, { type: "approve-all" });
    view.rerender(
      <BrandMemoryProvider repository={new MockBrandMemoryRepository()}>
        <ApprovalStage state={approvedState} dispatch={dispatch} />
      </BrandMemoryProvider>
    );

    const readyItems = pmApprovedClientSlideItems(approvedState);
    expect(readyItems).toHaveLength(approvedState.outputs.length);
    expect(
      readyItems.some((item) => item.output.format.toUpperCase().includes("UGC"))
    ).toBe(true);
    const readyGoogleSlides = stage.getByRole("button", {
      name: `Open in Google Slides · ${approvedState.outputs.length}`
    }) as HTMLButtonElement;
    expect(readyGoogleSlides.disabled).toBe(false);
  });

  it("exports approved album panels as one composed client slide", async () => {
    const base = buildCreativeState();
    const source = base.outputs[0];
    if (!source) throw new Error("Expected a creative output fixture.");
    const albumState = workflowReducer(
      {
        ...base,
        outputs: [3, 1, 2].map((panel) => ({
          ...source,
          id: `${source.directionId}-album-${panel}-v1`,
          format: "Album post",
          assetUrl: `https://example.com/album-${panel}.png`
        }))
      },
      { type: "approve-all" }
    );

    const items = pmApprovedClientSlideItems(albumState);

    expect(items).toHaveLength(1);
    expect(items[0]?.outputs.map((output) => output.id)).toEqual([
      `${source.directionId}-album-1-v1`,
      `${source.directionId}-album-2-v1`,
      `${source.directionId}-album-3-v1`
    ]);

    const imageData =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xz4mAAAAAElFTkSuQmCC";
    const pptx = await buildPmApprovedClientSlidesPptx(
      albumState,
      vi.fn().mockResolvedValue(imageData)
    );
    const slides = (
      pptx as unknown as {
        _slides: Array<{
          _slideObjects: Array<{
            _type: string;
            options: { x: number; y: number; w: number; h: number };
          }>;
        }>;
      }
    )._slides;
    const artwork = slides[0]?._slideObjects
      .filter((object) => object._type === "image")
      .map(({ options }) => ({
        x: Number(options.x.toFixed(3)),
        y: Number(options.y.toFixed(3)),
        w: Number(options.w.toFixed(3)),
        h: Number(options.h.toFixed(3))
      }));

    expect(slides).toHaveLength(1);
    expect(artwork).toEqual([
      { x: 0.65, y: 0.83, w: 5.85, h: 2.925 },
      { x: 0.65, y: 3.755, w: 2.925, h: 2.925 },
      { x: 3.575, y: 3.755, w: 2.925, h: 2.925 }
    ]);
  });

  it("groups an album into one Client card and applies decisions to every image", async () => {
    const user = userEvent.setup();
    const base = buildClientState();
    const source = base.outputs[0];
    if (!source) throw new Error("Expected a creative output fixture.");
    const albumOutputs = [1, 2, 3].map((panel) => ({
      ...source,
      id: `${source.directionId}-album-${panel}-v1`,
      format: "Album post",
      clientStatus: "sent" as const,
      assetUrl: `https://example.com/client-album-${panel}.png`
    }));
    const state = { ...base, outputs: albumOutputs };
    const dispatch = vi.fn();
    const view = render(<ClientStage state={state} dispatch={dispatch} />);
    const stage = within(view.container);

    expect(
      view.container.querySelectorAll(".compass-client-card")
    ).toHaveLength(1);
    expect(
      view.container.querySelectorAll(
        ".compass-client-card .compass-album-panels img"
      )
    ).toHaveLength(3);
    expect(stage.getAllByRole("button", { name: "Request changes" })).toHaveLength(
      1
    );
    expect(stage.getAllByRole("button", { name: "Approve" })).toHaveLength(1);
    expect(stage.getByText("0 / 1 approved")).toBeTruthy();

    await user.click(stage.getByRole("button", { name: "Approve" }));
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual(
      albumOutputs.map((output) => ({
        type: "approve-output",
        id: output.id
      }))
    );

    dispatch.mockClear();
    await user.click(stage.getByRole("button", { name: "Request changes" }));
    expect(
      stage
        .getByRole("dialog", { name: "Request changes" })
        .classList.contains("compass-qc-decision-modal")
    ).toBe(true);
    await user.click(stage.getByRole("button", { name: "Both" }));
    await user.type(
      stage.getByRole("textbox", { name: "Change instruction" }),
      "Make the album story easier to follow."
    );
    await user.click(stage.getByRole("button", { name: "Route changes" }));

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual(
      albumOutputs.map((output) => ({
        type: "request-client-change",
        id: output.id,
        targetRole: "both",
        comment: "Make the album story easier to follow."
      }))
    );
    const routedAlbum = dispatch.mock.calls.reduce<WorkflowState>(
      (current, [action]) =>
        workflowReducer(current, action as WorkflowAction),
      state
    );
    expect(
      routedAlbum.outputs.every(
        (output) =>
          output.clientStatus === "revision" &&
          output.approval.graphicDesign === "rejected"
      )
    ).toBe(true);
  });

  it("lets viewers open Client artwork while keeping feedback actions disabled", async () => {
    const user = userEvent.setup();
    const state = buildClientState();
    const dispatch = vi.fn();
    const view = render(
      <ClientStage state={state} dispatch={dispatch} canEdit={false} />
    );
    const stage = within(view.container);

    expect(
      stage
        .getAllByRole("button", { name: "Request changes" })
        .every((button) => (button as HTMLButtonElement).disabled)
    ).toBe(true);
    expect(
      stage
        .getAllByRole("button", { name: "Approve" })
        .every((button) => (button as HTMLButtonElement).disabled)
    ).toBe(true);

    await user.click(
      stage.getByRole("button", { name: /Open creative 1 preview/i })
    );
    expect(
      stage.getByRole("dialog", { name: "Creative 1 preview" })
    ).toBeTruthy();
    await user.click(stage.getByRole("button", { name: "Close" }));
    expect(stage.queryByRole("dialog")).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("opens a client revision in the selected Internal QC queue instead of PM", () => {
    const state = buildClientState();
    const output = state.outputs[0];
    if (!output) throw new Error("Expected a creative output fixture.");
    const routed = workflowReducer(state, {
      type: "request-client-change",
      id: output.id,
      targetRole: "clientService",
      comment: "Make the client-facing message more precise."
    });
    const view = render(
      <BrandMemoryProvider repository={new MockBrandMemoryRepository()}>
        <ApprovalStage state={routed} dispatch={vi.fn()} />
      </BrandMemoryProvider>
    );
    const stage = within(view.container);

    expect(
      stage.getByRole("heading", { name: "Assets in CS review" })
    ).toBeTruthy();
    expect(
      stage.getByText("Make the client-facing message more precise.")
    ).toBeTruthy();
    expect(
      stage.queryByRole("heading", { name: "Assets in PM review" })
    ).toBeNull();
  });

  it("requires client feedback before routing a creative to Internal QC", async () => {
    const user = userEvent.setup();
    const state = buildClientState();
    const dispatch = vi.fn();
    const view = render(<ClientStage state={state} dispatch={dispatch} />);
    const stage = within(view.container);
    const firstOutput = state.outputs[0];
    if (!firstOutput) throw new Error("Expected a creative output fixture.");

    expect(view.container.querySelector(".compass-stage-client")).toBeTruthy();
    expect(
      stage.getByRole("button", { name: "← Back to Internal QC" })
    ).toBeTruthy();
    expect(stage.getAllByRole("button", { name: "Request changes" })).toHaveLength(
      state.outputs.length
    );

    await user.click(stage.getAllByRole("button", { name: "Request changes" })[0]!);
    expect(stage.getByRole("dialog", { name: "Request changes" })).toBeTruthy();

    await user.click(stage.getByRole("button", { name: "Route changes" }));
    expect(
      stage.getByText(
        "Choose GD, CS, or Both and add one clear change instruction."
      )
    ).toBeTruthy();

    await user.click(stage.getByRole("button", { name: "CS" }));
    await user.type(
      stage.getByRole("textbox", { name: "Change instruction" }),
      "Make the product benefit easier to scan."
    );
    await user.click(stage.getByRole("button", { name: "Route changes" }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "request-client-change",
      id: firstOutput.id,
      targetRole: "clientService",
      comment: "Make the product benefit easier to scan."
    });
    expect(stage.queryByRole("dialog")).toBeNull();
  });
});
