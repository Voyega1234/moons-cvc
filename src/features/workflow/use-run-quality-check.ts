import { useCallback, useState, type Dispatch } from "react";
import { runQualityCheck } from "../../services/quality-check/run-quality-check";
import type { WorkflowAction, WorkflowState } from "./model";

export function useRunQualityCheck(
  state: WorkflowState,
  dispatch: Dispatch<WorkflowAction>
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    setError(null);

    try {
      const results = await runQualityCheck(state);
      dispatch({ type: "run-qa", results });
      return true;
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "Could not run quality check."
      );
      return false;
    } finally {
      setLoading(false);
    }
  }, [state, dispatch]);

  return { check, loading, error };
}
