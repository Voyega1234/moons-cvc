import { useCallback, useState, type Dispatch } from "react";
import { generateArtworkForSelectedHooks } from "../../services/artwork-generation/openai-image-generation";
import { playGenerationSuccessSound } from "../../shared/utils/notification-sound";
import type { WorkflowAction, WorkflowState } from "./model";

export function useCreateSelectedHooks(
  state: WorkflowState,
  dispatch: Dispatch<WorkflowAction>
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(() => {
    setLoading(true);
    setError(null);

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
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not create selected hooks."
        );
      })
      .finally(() => {
        setLoading(false);
      });
  }, [state, dispatch]);

  return { create, loading, error };
}
