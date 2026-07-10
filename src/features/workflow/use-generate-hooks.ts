import { useCallback, useState, type Dispatch } from "react";
import { env } from "../../config/env";
import { generateDirectionsWithHarness } from "../../services/creative-generation/harness-hook-generation";
import { generateDirectionsFromWebhook } from "../../services/creative-generation/n8n-hook-generation";
import type { WorkflowAction, WorkflowState } from "./model";

export function useGenerateHooks(
  state: WorkflowState,
  dispatch: Dispatch<WorkflowAction>
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(() => {
    setLoading(true);
    setError(null);

    const generation =
      env.hookGenerationMode === "harness"
        ? generateDirectionsWithHarness({ run: state })
        : generateDirectionsFromWebhook({
            brand: state.brand,
            service: state.service,
            quantity: state.quantity,
            brief: state.brief
          });

    void generation
      .then((directions) => {
        dispatch({ type: "generate-directions", directions });
      })
      .catch((caught: unknown) => {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not generate hooks."
        );
      })
      .finally(() => {
        setLoading(false);
      });
  }, [state.brand, state.service, state.quantity, state.brief, dispatch]);

  return { generate, loading, error };
}

export function useGenerateMoreHooks(
  state: WorkflowState,
  dispatch: Dispatch<WorkflowAction>
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateMore = useCallback(
    (extraInstructions: string) => {
      setLoading(true);
      setError(null);

      const existingHooks = state.directions.map((direction) => ({
        hook: direction.hook,
        concept: direction.concept
      }));

      const generation =
        env.hookGenerationMode === "harness"
          ? generateDirectionsWithHarness({ run: state, extraInstructions })
          : generateDirectionsFromWebhook({
              brand: state.brand,
              service: state.service,
              quantity: state.quantity,
              brief: state.brief,
              extraInstructions,
              existingHooks
            });

      void generation
        .then((directions) => {
          dispatch({ type: "generate-more-directions", directions });
        })
        .catch((caught: unknown) => {
          setError(
            caught instanceof Error
              ? caught.message
              : "Could not generate more hooks."
          );
        })
        .finally(() => {
          setLoading(false);
        });
    },
    [state, dispatch]
  );

  return { generateMore, loading, error };
}
