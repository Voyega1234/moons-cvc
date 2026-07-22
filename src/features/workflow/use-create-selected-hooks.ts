import { useCallback, useState, type Dispatch } from "react";
import { useOptionalWorkspace } from "../../app/providers/workspace-provider";
import {
  artworkReferencesFromSelections,
  generateArtworkForSelectedHooks
} from "../../services/artwork-generation/openai-image-generation";
import { playGenerationSuccessSound } from "../../shared/utils/notification-sound";
import type { WorkflowAction, WorkflowState } from "./model";

export function useCreateSelectedHooks(
  state: WorkflowState,
  dispatch: Dispatch<WorkflowAction>
) {
  const createCheckpoint = useOptionalWorkspace()?.createCheckpoint;
  const [progress, setProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const loading = state.artworkGenerationStatus === "running";
  const error =
    state.artworkGenerationStatus === "failed"
      ? state.artworkGenerationError
      : null;

  const create = useCallback(() => {
    if (state.artworkGenerationStatus === "running") return;
    setProgress({ completed: 0, total: 0 });
    dispatch({ type: "start-artwork-generation" });

    void generateArtworkForSelectedHooks({
      run: state,
      referenceImages: artworkReferencesFromSelections(state.referenceImages),
      onProgress: (completed, total) => setProgress({ completed, total }),
      onBatch: (outputs) =>
        dispatch({ type: "append-artwork-generation-outputs", outputs })
    })
      .then(async (outputs) => {
        if (state.outputs.length) {
          await createCheckpoint?.("regenerate", state.id);
        }
        dispatch({ type: "create-outputs", outputs });
        playGenerationSuccessSound();
      })
      .catch((caught: unknown) => {
        setProgress(null);
        dispatch({
          type: "fail-artwork-generation",
          message:
            caught instanceof Error
              ? caught.message
              : "Could not create selected hooks."
        });
      });
  }, [state, dispatch, createCheckpoint]);

  return { create, loading, error, progress };
}
