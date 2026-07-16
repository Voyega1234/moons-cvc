import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateDirectionsFromWebhook } from "../../services/creative-generation/n8n-hook-generation";
import { createInitialWorkflowState } from "./reducer";
import { buildDirectionFixtures } from "./test-fixtures";
import {
  buildCreativeMixInstructions,
  buildSuccessMetricInstructions,
  useGenerateMoreHooks
} from "./use-generate-hooks";

vi.mock("../../services/creative-generation/n8n-hook-generation", () => ({
  generateDirectionsFromWebhook: vi.fn()
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
      "Creative mix quota: Single static × 2. Generate 4 hook candidates in total. Candidate pool by content type: Single static × 4. Always generate 2 extra candidates for every active content type."
    );
  });
});

describe("useGenerateMoreHooks", () => {
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

    act(() => result.current.generateMore("album-post"));

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
        contentTypeQuotas: [{ service: "album-post", count: 3 }]
      })
    );
    await waitFor(() => expect(result.current.loadingService).toBeNull());
  });
});
