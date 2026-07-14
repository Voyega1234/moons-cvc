import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode
} from "react";
import type {
  WorkspaceAction,
  WorkspaceState
} from "../../features/workflow/model";
import {
  createInitialWorkspaceState,
  workspaceReducer
} from "../../features/workflow/workspace-reducer";
import type { WorkspaceRepository } from "../../ports/workspace-repository";
import { createId, nowIso } from "../../shared/utils/id";

interface WorkspaceContextValue {
  workspace: WorkspaceState;
  dispatch: Dispatch<WorkspaceAction>;
  persistenceError: Error | null;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({
  repository,
  children
}: {
  repository: WorkspaceRepository;
  children: ReactNode;
}) {
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [loadingError, setLoadingError] = useState<Error | null>(null);
  const [persistenceError, setPersistenceError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;

    void repository
      .load()
      .then((persisted) => {
        if (!active) return;
        setWorkspace(
          persisted ??
            createInitialWorkspaceState({
              runId: createId("run"),
              now: nowIso()
            })
        );
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadingError(toError(error, "Could not restore the workspace."));
      });

    return () => {
      active = false;
    };
  }, [repository]);

  useEffect(() => {
    if (!workspace) return;

    void repository
      .save(workspace)
      .then(() => setPersistenceError(null))
      .catch((error: unknown) => {
        setPersistenceError(toError(error, "Could not save the workspace."));
      });
  }, [repository, workspace]);

  const dispatch = useCallback<Dispatch<WorkspaceAction>>((action) => {
    setWorkspace((current) =>
      current ? workspaceReducer(current, action) : current
    );
  }, []);

  if (loadingError) {
    return (
      <main className="boot-error">
        <h1>Neo could not restore this workspace.</h1>
        <p>{loadingError.message}</p>
      </main>
    );
  }

  if (!workspace) {
    return (
      <main className="boot-loading" aria-live="polite">
        Loading Neo...
      </main>
    );
  }

  return (
    <WorkspaceContext.Provider
      value={{ workspace, dispatch, persistenceError }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used inside WorkspaceProvider.");
  }
  return context;
}

function toError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(fallback);
}
