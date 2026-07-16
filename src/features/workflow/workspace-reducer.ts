import type {
  WorkspaceAction,
  WorkspaceState,
  WorkspaceToast,
  WorkflowState
} from "./model";
import {
  createInitialWorkflowState,
  workflowActionToast,
  workflowReducer
} from "./reducer";
import { workflowActionBlockReason } from "./rules";

export function createInitialWorkspaceState({
  runId,
  now
}: {
  runId: string;
  now: string;
}): WorkspaceState {
  const run = createInitialWorkflowState({ id: runId, now });
  return {
    view: "studio",
    activeRunId: runId,
    runOrder: [runId],
    runsById: { [runId]: run },
    toast: null
  };
}

export function getActiveRun(state: WorkspaceState): WorkflowState {
  const run = state.runsById[state.activeRunId];
  if (!run) {
    throw new Error(`Active run "${state.activeRunId}" does not exist.`);
  }
  return run;
}

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction
): WorkspaceState {
  switch (action.type) {
    case "set-view":
      return { ...state, view: action.view };
    case "create-run": {
      if (state.runsById[action.id]) return state;
      const activeRun = getActiveRun(state);
      const run = createInitialWorkflowState({
        id: action.id,
        now: action.now,
        brand: action.keepBrand ? activeRun.brand : null
      });
      return {
        ...state,
        view: "studio",
        activeRunId: run.id,
        runOrder: [...state.runOrder, run.id],
        runsById: { ...state.runsById, [run.id]: run },
        toast: successToast(
          "New run opened",
          action.keepBrand
            ? "Brand context was copied into a fresh creative run."
            : "Choose a brand to begin the new creative run."
        )
      };
    }
    case "switch-run":
      return state.runsById[action.id]
        ? {
            ...state,
            view: "studio",
            activeRunId: action.id,
            toast: null
          }
        : state;
    case "close-run": {
      if (state.runOrder.length === 1 || !state.runsById[action.id]) {
        return {
          ...state,
          toast: warningToast(
            "Keep one run open",
            "Create another run before closing this one."
          )
        };
      }

      const closedIndex = state.runOrder.indexOf(action.id);
      const runOrder = state.runOrder.filter((id) => id !== action.id);
      const { [action.id]: _closed, ...runsById } = state.runsById;
      const nextActiveId =
        action.id === state.activeRunId
          ? runOrder[Math.max(0, closedIndex - 1)]
          : state.activeRunId;

      if (!nextActiveId) {
        throw new Error("Closing a run left the workspace without an active run.");
      }

      return {
        ...state,
        activeRunId: nextActiveId,
        runOrder,
        runsById,
        toast: successToast(
          "Run closed",
          "Your remaining creative runs are unchanged."
        )
      };
    }
    case "apply-run-action": {
      const targetRun = state.runsById[action.runId];
      // The run this async action was started against may have been closed
      // before the request resolved — nothing sensible to apply it to.
      if (!targetRun) return state;

      const blockedReason = workflowActionBlockReason(
        targetRun,
        action.action
      );
      if (blockedReason) {
        return {
          ...state,
          toast: warningToast("Action needed", blockedReason)
        };
      }

      const nextRun = {
        ...workflowReducer(targetRun, action.action),
        updatedAt: action.now
      };
      return {
        ...state,
        runsById: {
          ...state.runsById,
          [nextRun.id]: nextRun
        },
        toast: workflowActionToast(action.action, nextRun) ?? state.toast
      };
    }
    case "clear-toast":
      return { ...state, toast: null };
  }
}

function successToast(title: string, message: string): WorkspaceToast {
  return { title, message, tone: "success" };
}

function warningToast(title: string, message: string): WorkspaceToast {
  return { title, message, tone: "warning" };
}
