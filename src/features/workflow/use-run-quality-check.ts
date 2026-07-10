import { useCallback, useState, type Dispatch } from "react";
import { runQualityCheck } from "../../services/quality-check/run-quality-check";
import type { WorkflowAction, WorkflowState } from "./model";

export function useRunQualityCheck(
  state: WorkflowState,
  dispatch: Dispatch<WorkflowAction>
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(() => {
    setLoading(true);
    setError(null);

    void runQualityCheck(state)
      .then((results) => {
        dispatch({ type: "run-qa", results });
      })
      .catch((caught: unknown) => {
        setError(
          caught instanceof Error ? caught.message : "Could not run quality check."
        );
      })
      .finally(() => {
        setLoading(false);
      });
  }, [state, dispatch]);

  return { check, loading, error };
}
