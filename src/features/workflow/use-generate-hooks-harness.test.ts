import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateDirectionsWithHarness,
  generateHookResearchWithHarness
} from "../../services/creative-generation/harness-hook-generation";
import { createInitialWorkflowState } from "./reducer";
import { buildDirectionFixtures } from "./test-fixtures";
import { useGenerateHooks } from "./use-generate-hooks";

vi.mock("../../config/env", () => ({
  env: { hookGenerationMode: "harness" }
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
});

describe("useGenerateHooks harness resilience", () => {
  it("starts all five selected models concurrently after shared Research", async () => {
    const state = {
      ...createInitialWorkflowState({
        id: "five-model-run",
        now: "2026-08-11T06:10:00.000Z"
      }),
      hookGenerationModels: [
        "google/gemini-3.6-flash",
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

  it("shares one Research dossier and keeps successful results when one model fails", async () => {
    const state = {
      ...createInitialWorkflowState({
        id: "shared-research-run",
        now: "2026-08-11T06:00:00.000Z"
      }),
      hookGenerationModels: [
        "google/gemini-3.6-flash",
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
            generationModel: "google/gemini-3.6-flash"
          })
        ]
      })
    );
    expect(generateHookResearchWithHarness).toHaveBeenCalledTimes(1);
    expect(generateDirectionsWithHarness).toHaveBeenCalledTimes(2);
    expect(generateDirectionsWithHarness).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ researchDossier: dossier })
    );
    expect(generateDirectionsWithHarness).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ researchDossier: dossier })
    );
  });
});
