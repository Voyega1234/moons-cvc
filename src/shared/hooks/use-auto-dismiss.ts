import { useEffect, type Dispatch } from "react";
import { UI_TIMING } from "../constants/ui";

export function useAutoDismiss<Action>(
  active: unknown,
  dispatch: Dispatch<Action>,
  action: Action,
  durationMs = UI_TIMING.toastDurationMs
): void {
  useEffect(() => {
    if (!active) return;

    const timeout = window.setTimeout(() => dispatch(action), durationMs);
    return () => window.clearTimeout(timeout);
  }, [active, action, dispatch, durationMs]);
}
