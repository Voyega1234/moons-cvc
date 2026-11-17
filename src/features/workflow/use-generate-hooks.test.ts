import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateDirectionsFromNewCompassWebhook,
  generateDirectionsFromWebhook
} from "../../services/creative-generation/n8n-hook-generation";
import { createInitialWorkflowState } from "./reducer";
import { buildDirectionFixtures } from "./test-fixtures";
import {
  buildCreativeMixInstructions,
  buildHookRegenerationInstructions,
  buildIdeaIntentInstructions,
  buildSuccessMetricInstructions,
  selectedHookGenerationModels,
  useGenerateMoreHooks
} from "./use-generate-hooks";

vi.mock("../../services/creative-generation/n8n-hook-generation", () => ({
  generateDirectionsFromWebhook: vi.fn(),
  generateDirectionsFromNewCompassWebhook: vi.fn()
}));

vi.mock("../../config/env", () => ({
  env: { hookGenerationMode: "n8n" }
}));

vi.mock("../../shared/utils/notification-sound", () => ({
  playGenerationSuccessSound: vi.fn()
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildSuccessMetricInstructions", () => {
  it("passes the selected Brief metric through existing generation instructions", () => {
    expect(buildSuccessMetricInstructions("ROAS")).toBe(
      "Primary success metric: ROAS. Make the angle support this outcome without inventing performance claims."
    );
  });
});

describe("buildIdeaIntentInstructions", () => {
  it("keeps an assigned topic while demanding genuinely different executions", () => {
    const instructions = buildIdeaIntentInstructions("develop");

    expect(instructions).toContain("Keep the assigned topic");
    expect(instructions).toContain(
      "audience tension or insight, product role, and creative mechanism"
    );
    expect(instructions).toContain(
      "A different Hook format or wording alone is not a different idea"
    );
  });
});

describe("buildHookRegenerationInstructions", () => {
  const direction = buildDirectionFixtures("Improve")[0]!;

  it("keeps the strategic concept when polishing copy", () => {
    const instructions = buildHookRegenerationInstructions(
      direction,
      "Make the Thai wording sound natural.",
      "polish-copy"
    );

    expect(instructions).toContain("strategic concept should stay the same");
    expect(instructions).toContain("Keep the same strategic idea");
  });

  it("allows the strategic concept to change instead of paraphrasing it", () => {
    const instructions = buildHookRegenerationInstructions(
      direction,
      "The topic misses the brief.",
      "replace-concept"
    );

    expect(instructions).toContain("Replace one existing idea");
    expect(instructions).toContain("Use the original as an anti-reference");
    expect(instructions).toContain("Do not merely paraphrase");
    expect(instructions).not.toContain("Keep the same strategic idea");
  });
});

describe("buildCreativeMixInstructions", () => {
  it("does not send zero-count content types to the hook prompt", () => {
    const state = {
      creativeMix: [
        { id: "static", service: "single-static", quantity: 2 },
        { id: "ugc", service: "ugc-video", quantity: 0 },
        { id: "album", service: "album-post", quantity: 0 }
      ],
      service: "single-static",
      quantity: 2
    } as const;

    expect(buildCreativeMixInstructions(state)).toBe(
      "Creative mix quota: Single static × 2. Generate 4 finished hook directions in one pass: the exact requested quantity plus 2 additional finished options for every active content type. Do not create or return an intermediate candidate pool."
    );
  });
});

describe("selectedHookGenerationModels", () => {
  it("normalizes retired selections to supported models and deduplicates them", () => {
    expect(selectedHookGenerationModels({
      hookGenerationModel: "google/gemini-3.6-flash",
      hookGenerationModels: ["google/gemini-3.6-flash", "openai/gpt-5.6-terra", "sakana/sakana-namazu", "google/gemini-3.8-flash"]
    })).toEqual(["google/gemini-4-hydrogen", "openai/gpt-6.1-terra", "google/gemini-3.8-flash"]);
  });
});

describe("useGenerateMoreHooks", () => {
  it("uses the default Gemini model for a retired n8n selection", async () => {
    const state = { ...createInitialWorkflowState({ id: "legacy", now: "2026-11-17T00:00:00Z" }),
      hookGenerationModel: "n8n-compass-new", hookGenerationModels: ["n8n-compass-new"], directions: buildDirectionFixtures("Existing") };
    vi.mocked(generateDirectionsFromWebhook).mockResolvedValue([state.directions[0]!]);
    const { result } = renderHook(() => useGenerateMoreHooks(state, vi.fn()));
    act(() => result.current.generateMore("single-static"));
    await waitFor(() => expect(generateDirectionsFromWebhook).toHaveBeenCalledTimes(1));
    expect(generateDirectionsFromNewCompassWebhook).not.toHaveBeenCalled();
  });

  it("requests and appends ideas only for the selected content type", async () => {
    const state = {
      ...createInitialWorkflowState({
        id: "generate-more-run",
        now: "2026-07-16T00:00:00.000Z"
      }),
      creativeMix: [
        { id: "static", service: "single-static" as const, quantity: 2 },
        { id: "album", service: "album-post" as const, quantity: 1 }
      ],
      quantity: 3,
      hookGenerationModels: ["google/gemini-3.6-flash"] as const,
      directions: buildDirectionFixtures("Targeted")
    };
    const generatedDirection = {
      ...state.directions[0]!,
      id: "generated-album-idea",
      service: "single-static" as const
    };
    vi.mocked(generateDirectionsFromWebhook).mockResolvedValue([
      generatedDirection
    ]);
    const dispatch = vi.fn();
    const { result } = renderHook(() =>
      useGenerateMoreHooks(state, dispatch)
    );

    act(() =>
      result.current.generateMore(
        "album-post",
        "Explore calmer premium rituals and unusual camera angles."
      )
    );

    expect(result.current.loadingService).toBe("album-post");
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({
        type: "generate-more-directions",
        directions: [
          expect.objectContaining({
            id: "generated-album-idea",
            service: "album-post"
          })
        ]
      })
    );
    expect(generateDirectionsFromWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "album-post",
        quantity: 3,
        contentTypeQuotas: [{ service: "album-post", count: 3 }],
        extraInstructions: expect.stringContaining(
          "Explore calmer premium rituals and unusual camera angles."
        )
      })
    );
    await waitFor(() => expect(result.current.loadingService).toBeNull());
  });

  it("starts selected model runs together and tags each model's ideas", async () => {
    const state = {
      ...createInitialWorkflowState({
        id: "compare-models-run",
        now: "2026-08-10T00:00:00.000Z"
      }),
      hookGenerationModels: [
        "google/gemini-4-hydrogen",
        "openai/gpt-6.1-terra"
      ] as const,
      directions: buildDirectionFixtures("Compared")
    };
    const generatedDirection = {
      ...state.directions[0]!,
      id: "compared-direction"
    };
    const resolvers: ((directions: typeof state.directions) => void)[] = [];
    vi.mocked(generateDirectionsFromWebhook).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        })
    );
    const dispatch = vi.fn();
    const { result } = renderHook(() => useGenerateMoreHooks(state, dispatch));

    act(() => result.current.generateMore("single-static"));

    await waitFor(() =>
      expect(generateDirectionsFromWebhook).toHaveBeenCalledTimes(2)
    );
    await act(async () => {
      resolvers.forEach((resolve) => resolve([generatedDirection]));
    });

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({
        type: "generate-more-directions",
        directions: [
          expect.objectContaining({
            generationModel: "google/gemini-4-hydrogen"
          }),
          expect.objectContaining({
            generationModel: "openai/gpt-6.1-terra"
          })
        ]
      })
    );
  });
});
