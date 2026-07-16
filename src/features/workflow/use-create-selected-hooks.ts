import { useCallback, type Dispatch } from "react";
import { generateArtworkForSelectedHooks } from "../../services/artwork-generation/openai-image-generation";
import { playGenerationSuccessSound } from "../../shared/utils/notification-sound";
import type { WorkflowAction, WorkflowState } from "./model";

export function useCreateSelectedHooks(
  state: WorkflowState,
  dispatch: Dispatch<WorkflowAction>
) {
  const loading = state.artworkGenerationStatus === "running";
  const error =
    state.artworkGenerationStatus === "failed"
      ? state.artworkGenerationError
      : null;

  const create = useCallback(() => {
    if (state.artworkGenerationStatus === "running") return;
    dispatch({ type: "start-artwork-generation" });

    void generateArtworkForSelectedHooks({
      run: state,
      referenceImages: state.referenceImages.map((item) => ({
        kind: "url" as const,
        url: item.url,
        label: item.label
      }))
    })
      .then((outputs) => {
        dispatch({ type: "create-outputs", outputs });
        playGenerationSuccessSound();
      })
      .catch((caught: unknown) => {
        dispatch({
          type: "fail-artwork-generation",
          message:
            caught instanceof Error
              ? caught.message
              : "Could not create selected hooks."
        });
      });
  }, [state, dispatch]);

  return { create, loading, error };
}
