import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateArtworkForSelectedHooks } from "../../services/artwork-generation/openai-image-generation";
import { createInitialWorkflowState } from "./reducer";
import { buildDirectionFixtures } from "./test-fixtures";
import { useCreateSelectedHooks } from "./use-create-selected-hooks";

vi.mock("../../services/artwork-generation/openai-image-generation", () => ({
  artworkReferencesFromSelections: vi.fn(() => []),
  generateArtworkForSelectedHooks: vi.fn()
}));

vi.mock("../../shared/utils/notification-sound", () => ({
  playGenerationSuccessSound: vi.fn()
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useCreateSelectedHooks", () => {
  it("keeps generation blocked after the Hooks stage remounts", async () => {
    let finishGeneration: ((outputs: []) => void) | undefined;
    const pendingGeneration = new Promise<[]>((resolve) => {
      finishGeneration = resolve;
    });
    vi.mocked(generateArtworkForSelectedHooks).mockReturnValue(
      pendingGeneration
    );
    const dispatch = vi.fn();
    const state = createInitialWorkflowState({
      id: "artwork-run",
      now: "2026-07-16T12:00:00.000Z"
    });

    const firstMount = renderHook(() =>
      useCreateSelectedHooks(state, dispatch)
    );
    act(() => firstMount.result.current.create());

    expect(dispatch).toHaveBeenCalledWith({
      type: "start-artwork-generation"
    });
    expect(generateArtworkForSelectedHooks).toHaveBeenCalledTimes(1);
    firstMount.unmount();

    const runningState = {
      ...state,
      artworkGenerationStatus: "running" as const
    };
    const secondMount = renderHook(() =>
      useCreateSelectedHooks(runningState, dispatch)
    );

    expect(secondMount.result.current.loading).toBe(true);
    act(() => secondMount.result.current.create());
    expect(generateArtworkForSelectedHooks).toHaveBeenCalledTimes(1);

    finishGeneration?.([]);
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({
        type: "create-outputs",
        outputs: []
      })
    );
  });

  it("refreshes Brand Colors before building artwork requests", async () => {
    vi.mocked(generateArtworkForSelectedHooks).mockResolvedValue([]);
    const dispatch = vi.fn();
    const palette = {
      id: "primary-colors",
      title: "Colors",
      description: "#FFFFFF, #E7CEB5, #006072, #A38D5C"
    };
    const brandMemoryRepository = {
      listBrandRules: vi.fn().mockResolvedValue([palette])
    };
    const state = createInitialWorkflowState({
      id: "artwork-run",
      now: "2026-07-30T00:00:00.000Z",
      brand: {
        id: "chol",
        name: "Chol",
        category: "Health/beauty",
        initials: "CH",
        library: { brand: [], products: [], docs: [], refs: [] },
        memory: { working: [], avoid: [] }
      }
    });

    const view = renderHook(() =>
      useCreateSelectedHooks(state, dispatch, brandMemoryRepository)
    );
    act(() => view.result.current.create());

    await waitFor(() =>
      expect(generateArtworkForSelectedHooks).toHaveBeenCalledWith(
        expect.objectContaining({
          run: expect.objectContaining({
            brand: expect.objectContaining({
              library: expect.objectContaining({ brand: [palette] })
            })
          })
        })
      )
    );
    expect(brandMemoryRepository.listBrandRules).toHaveBeenCalledWith("chol");
    expect(dispatch).toHaveBeenCalledWith({
      type: "sync-brand-rules",
      items: [palette]
    });
  });

  it("replaces a hook's shared reference instead of piling it on, while keeping its own reference", async () => {
    vi.mocked(generateArtworkForSelectedHooks).mockResolvedValue([]);
    const dispatch = vi.fn();
    const direction = {
      ...buildDirectionFixtures("Chol")[0]!,
      selected: true,
      referenceImages: [
        {
          id: "hook-own",
          url: "https://example.com/hook-own.png",
          label: "Hook-specific pick",
          fromSharedReference: false
        },
        {
          id: "shared-stale",
          url: "https://example.com/shared-old.png",
          label: "Old shared pick",
          fromSharedReference: true
        }
      ]
    };
    const state = {
      ...createInitialWorkflowState({
        id: "artwork-run",
        now: "2026-08-21T00:00:00.000Z"
      }),
      directions: [direction],
      referenceImages: [
        {
          id: "shared-new",
          url: "https://example.com/shared-new.png",
          label: "New shared pick"
        }
      ]
    };

    const view = renderHook(() => useCreateSelectedHooks(state, dispatch));
    act(() => view.result.current.create());

    await waitFor(() =>
      expect(generateArtworkForSelectedHooks).toHaveBeenCalledWith(
        expect.objectContaining({
          run: expect.objectContaining({
            directions: [
              expect.objectContaining({
                id: direction.id,
                referenceImages: [
                  expect.objectContaining({ id: "hook-own" }),
                  expect.objectContaining({ id: "shared-new" })
                ]
              })
            ]
          })
        })
      )
    );

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "set-direction-reference-images",
        id: direction.id
      })
    );
  });
});
