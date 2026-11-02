import { act, renderHook, waitFor } from "@testing-library/react";
import { useReducer } from "react";
import type { Brand } from "../../domain/brand";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateDirectionsWithHarness,
  generateHookResearchWithHarness
} from "../../services/creative-generation/harness-hook-generation";
import { createInitialWorkflowState, workflowReducer } from "./reducer";
import { buildDirectionFixtures } from "./test-fixtures";
import { useGenerateHooks } from "./use-generate-hooks";
import { withCreativeApprovalContext } from "../../services/creative-generation/creative-approval-context";

vi.mock("../../services/creative-generation/creative-approval-context", () => ({
  withCreativeApprovalContext: vi.fn(async brand => brand)
}));

vi.mock("../../config/env", () => ({
  env: { hookGenerationMode: "harness", dataSource: "supabase" }
}));

vi.mock("../../services/creative-generation/harness-hook-generation", () => ({
  generateDirectionsWithHarness: vi.fn(),
  generateHookResearchWithHarness: vi.fn()
}));

vi.mock("../../shared/utils/notification-sound", () => ({
  playGenerationSuccessSound: vi.fn()
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(withCreativeApprovalContext).mockImplementation(async brand => brand);
});

describe("useGenerateHooks harness resilience", () => {
  it("shows the Creative Approval phase and retains the imported context in the run", async () => {
    const brand = { id: "brand", name: "Brand", category: "", initials: "B", mappingClientPortalUrl: "https://docs.google.com/spreadsheets/d/portal/edit", library: { brand: [], products: [], refs: [], docs: [] }, memory: { working: [], avoid: [] } };
    const initial = { ...createInitialWorkflowState({ id: "status-run", now: "2026-11-02T00:00:00Z" }), brand, hookGenerationModel: "google/gemini-3.8-flash", hookGenerationModels: ["google/gemini-3.8-flash"] };
    const document = { id: "style", title: "Copy style from Creative Approval", description: "Saved context" };
    let finish: (brand: Brand | null) => void = () => {};
    vi.mocked(withCreativeApprovalContext).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    vi.mocked(generateDirectionsWithHarness).mockResolvedValue([buildDirectionFixtures("Status")[0]!]);
    const { result } = renderHook(() => {
      const [state, dispatch] = useReducer(workflowReducer, initial);
      return { ...useGenerateHooks(state, dispatch), state };
    });
    act(() => result.current.generate());
    await waitFor(() => expect(result.current.checkingCreativeApproval).toBe(true));
    expect(generateDirectionsWithHarness).not.toHaveBeenCalled();
    await act(async () => finish({ ...brand, library: { ...brand.library, docs: [document] } }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.checkingCreativeApproval).toBe(false);
    expect(result.current.state.brand?.library.docs).toEqual([document]);
  });

  it("syncs image-copy context once before starting model comparisons and sends it to every model", async () => {
    const state = {
      ...createInitialWorkflowState({ id: "style-context-run", now: "2026-11-02T00:00:00Z" }),
      hookGenerationModels: ["google/gemini-3.8-flash", "openai/gpt-5.6-terra"]
    };
    const brand = { id: "brand-1", name: "Sendo", category: "", initials: "S", memory: { working: [], avoid: [] }, library: { brand: [], products: [], refs: [], docs: [] } };
    const document = { id: "style", title: "Copy style from Creative Approval", description: "ประหยัดค่าแรง ค่าสีไม่ต้องทาซ้ำ" };
    vi.mocked(withCreativeApprovalContext).mockResolvedValue({ ...brand, library: { ...brand.library, docs: [document] } });
    vi.mocked(generateDirectionsWithHarness).mockResolvedValue([buildDirectionFixtures("Context")[0]!]);
    const dispatch = vi.fn();
    const { result } = renderHook(() => useGenerateHooks({ ...state, brand }, dispatch));
    act(() => result.current.generate());
    await waitFor(() => expect(generateDirectionsWithHarness).toHaveBeenCalledTimes(2));
    expect(withCreativeApprovalContext).toHaveBeenCalledExactlyOnceWith(brand, state.id);
    for (const [input] of vi.mocked(generateDirectionsWithHarness).mock.calls) expect(input.run.brand?.library.docs).toEqual([document]);
    expect(brand.library.docs).toEqual([]);
  });

  it.each(["Ads Post has no Artwork URL / AW Link columns.", "Reconnect Google", "Creative Approval Google read failed: HTTP 404", "Cannot read artwork"])("continues with existing brand context when the optional import fails: %s", async message => {
    const document = { id: "saved", title: "Existing brand context", description: "Keep this" };
    const brand: Brand = { id: "brand", name: "Brand", category: "", initials: "B", mappingClientPortalUrl: "https://docs.google.com/spreadsheets/d/portal/edit", library: { brand: [], products: [], refs: [], docs: [document] }, memory: { working: [], avoid: [] } };
    const state = { ...createInitialWorkflowState({ id: "style-error-run", now: "2026-11-02T00:00:00Z", brand }), hookGenerationModels: ["google/gemini-3.8-flash"] };
    vi.mocked(withCreativeApprovalContext).mockRejectedValue(new Error(message));
    vi.mocked(generateDirectionsWithHarness).mockResolvedValue([buildDirectionFixtures("Fallback")[0]!]);
    const { result } = renderHook(() => {
      const [current, dispatch] = useReducer(workflowReducer, state);
      return { ...useGenerateHooks(current, dispatch), state: current };
    });
    act(() => result.current.generate());
    await waitFor(() => expect(generateDirectionsWithHarness).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(generateDirectionsWithHarness).toHaveBeenCalledWith(expect.objectContaining({ run: expect.objectContaining({ brand }) }));
    expect(result.current.state.brand?.library.docs).toEqual([document]);
    expect(result.current.state.directions).toHaveLength(1);
    expect(result.current.creativeApprovalFailed).toBe(true);
    expect(result.current.checkingCreativeApproval).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("still surfaces a real Hook failure after an optional context failure", async () => {
    const state = { ...createInitialWorkflowState({ id: "model-error-run", now: "2026-11-02T00:00:00Z" }), hookGenerationModels: ["google/gemini-3.8-flash"] };
    vi.mocked(withCreativeApprovalContext).mockRejectedValue(new Error("Cannot read optional sheet"));
    vi.mocked(generateDirectionsWithHarness).mockRejectedValue(new Error("Unauthorized"));
    const dispatch = vi.fn();
    const { result } = renderHook(() => useGenerateHooks(state, dispatch));
    act(() => result.current.generate());
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: "fail-idea-generation", message: "Unauthorized" }));
    expect(generateDirectionsWithHarness).toHaveBeenCalledTimes(1);
  });

  it("starts all five OpenRouter models concurrently without preliminary Research", async () => {
    const state = {
      ...createInitialWorkflowState({
        id: "five-model-run",
        now: "2026-08-11T06:10:00.000Z"
      }),
      hookGenerationModels: [
        "google/gemini-3.8-flash",
        "qwen/qwen3.8-max",
        "sakana/sakana-namazu",
        "openai/gpt-5.6-terra",
        "meta-llama/llama-4-maverick"
      ]
    };
    const direction = buildDirectionFixtures("Concurrent")[0]!;
    let started = 0;
    let releaseModels: () => void = () => {};
    const modelGate = new Promise<void>((resolve) => {
      releaseModels = resolve;
    });
    vi.mocked(generateHookResearchWithHarness).mockResolvedValue({
      overallFinding: "Shared evidence"
    });
    vi.mocked(generateDirectionsWithHarness).mockImplementation(async () => {
      started += 1;
      await modelGate;
      return [direction];
    });
    const dispatch = vi.fn();
    const { result } = renderHook(() => useGenerateHooks(state, dispatch));

    act(() => result.current.generate());

    await waitFor(() => expect(started).toBe(5));
    releaseModels();
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "generate-directions" })
      )
    );
  });

  it("skips preliminary Research and keeps successful results when one model fails", async () => {
    const state = {
      ...createInitialWorkflowState({
        id: "shared-research-run",
        now: "2026-08-11T06:00:00.000Z"
      }),
      hookGenerationModels: [
        "google/gemini-3.8-flash",
        "qwen/qwen3.8-max"
      ]
    };
    const dossier = { overallFinding: "Shared evidence" };
    const successfulDirection = buildDirectionFixtures("Resilient")[0]!;
    vi.mocked(generateHookResearchWithHarness).mockResolvedValue(dossier);
    vi.mocked(generateDirectionsWithHarness)
      .mockResolvedValueOnce([successfulDirection])
      .mockRejectedValueOnce(new Error("Runtime failed before JSON response."));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const dispatch = vi.fn();
    const { result } = renderHook(() => useGenerateHooks(state, dispatch));

    act(() => result.current.generate());

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({
        type: "generate-directions",
        directions: [
          expect.objectContaining({
            generationModel: "google/gemini-3.8-flash"
          })
        ]
      })
    );
    expect(generateHookResearchWithHarness).not.toHaveBeenCalled();
    expect(generateDirectionsWithHarness).toHaveBeenCalledTimes(2);
    expect(generateDirectionsWithHarness).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ researchDossier: undefined })
    );
    expect(generateDirectionsWithHarness).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ researchDossier: undefined })
    );
  });
});
