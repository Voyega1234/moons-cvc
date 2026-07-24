import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
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
import type {
  WorkspaceCheckpoint,
  WorkspaceCheckpointReason
} from "../../ports/workspace-repository";
import { createId, nowIso } from "../../shared/utils/id";

interface WorkspaceContextValue {
  workspace: WorkspaceState;
  dispatch: Dispatch<WorkspaceAction>;
  persistenceError: Error | null;
  persistenceStatus: WorkspacePersistenceStatus;
  lastSavedAt: string | null;
  flush: () => Promise<void>;
  checkpoints: readonly WorkspaceCheckpoint[];
  checkpointError: Error | null;
  checkpointBusy: boolean;
  createCheckpoint: (
    reason: WorkspaceCheckpointReason,
    runId?: string
  ) => Promise<void>;
  refreshCheckpoints: (runId?: string) => Promise<void>;
  restoreCheckpoint: (checkpointId: string, runId?: string) => Promise<void>;
}

export type WorkspacePersistenceStatus =
  | "idle"
  | "saving"
  | "saved"
  | "error";

export const WORKSPACE_AUTOSAVE_DELAY_MS = 600;

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
  const [persistenceStatus, setPersistenceStatus] =
    useState<WorkspacePersistenceStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [checkpoints, setCheckpoints] = useState<
    readonly WorkspaceCheckpoint[]
  >([]);
  const [checkpointError, setCheckpointError] = useState<Error | null>(null);
  const [checkpointBusy, setCheckpointBusy] = useState(false);
  const workspaceRef = useRef<WorkspaceState | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveVersionRef = useRef(0);

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

  const saveSnapshot = useCallback(
    async (
      snapshot: WorkspaceState,
      version: number,
      rethrow = false
    ): Promise<void> => {
      try {
        await repository.save(snapshot);
        if (version === saveVersionRef.current) {
          setPersistenceError(null);
          setPersistenceStatus("saved");
          setLastSavedAt(nowIso());
        }
      } catch (error: unknown) {
        const resolved = toError(error, "Could not save the workspace.");
        if (version === saveVersionRef.current) {
          setPersistenceError(resolved);
          setPersistenceStatus("error");
        }
        if (rethrow) throw resolved;
      }
    },
    [repository]
  );

  useEffect(() => {
    if (!workspace) return;
    workspaceRef.current = workspace;
    setPersistenceError(null);
    setPersistenceStatus("saving");
    const version = ++saveVersionRef.current;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void saveSnapshot(workspace, version);
    }, WORKSPACE_AUTOSAVE_DELAY_MS);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [saveSnapshot, workspace]);

  const dispatch = useCallback<Dispatch<WorkspaceAction>>((action) => {
    setWorkspace((current) =>
      current ? workspaceReducer(current, action) : current
    );
  }, []);

  const flush = useCallback(async () => {
    const snapshot = workspaceRef.current;
    if (!snapshot) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const version = ++saveVersionRef.current;
    setPersistenceError(null);
    setPersistenceStatus("saving");
    await saveSnapshot(snapshot, version, true);
  }, [saveSnapshot]);

  const refreshCheckpoints = useCallback(
    async (runId?: string) => {
      const targetRunId = runId ?? workspaceRef.current?.activeRunId;
      if (!targetRunId || !repository.listCheckpoints) {
        setCheckpoints([]);
        return;
      }
      try {
        const next = await repository.listCheckpoints(targetRunId);
        if (workspaceRef.current?.activeRunId === targetRunId) {
          setCheckpoints(next);
          setCheckpointError(null);
        }
      } catch (error: unknown) {
        if (workspaceRef.current?.activeRunId === targetRunId) {
          setCheckpointError(
            toError(error, "Could not load project recovery points.")
          );
        }
      }
    },
    [repository]
  );

  const createCheckpoint = useCallback(
    async (reason: WorkspaceCheckpointReason, runId?: string) => {
      const targetRunId = runId ?? workspaceRef.current?.activeRunId;
      if (!targetRunId || !repository.createCheckpoint) return;
      setCheckpointBusy(true);
      setCheckpointError(null);
      try {
        await flush();
        const snapshot = workspaceRef.current;
        if (!snapshot) return;
        await repository.createCheckpoint(snapshot, targetRunId, reason);
        await refreshCheckpoints(targetRunId);
      } catch (error: unknown) {
        const resolved = toError(error, "Could not create a recovery point.");
        setCheckpointError(resolved);
        throw resolved;
      } finally {
        setCheckpointBusy(false);
      }
    },
    [flush, refreshCheckpoints, repository]
  );

  const restoreCheckpoint = useCallback(
    async (checkpointId: string, runId?: string) => {
      const current = workspaceRef.current;
      const targetRunId = runId ?? current?.activeRunId;
      if (!current || !targetRunId || !repository.restoreCheckpoint) return;
      setCheckpointBusy(true);
      setCheckpointError(null);
      try {
        await flush();
        const restored = await repository.restoreCheckpoint(
          current,
          targetRunId,
          checkpointId
        );
        workspaceRef.current = restored;
        saveVersionRef.current += 1;
        setWorkspace(restored);
        setPersistenceError(null);
        setPersistenceStatus("saved");
        setLastSavedAt(nowIso());
        await refreshCheckpoints(targetRunId);
      } catch (error: unknown) {
        const resolved = toError(error, "Could not restore this project.");
        setCheckpointError(resolved);
        throw resolved;
      } finally {
        setCheckpointBusy(false);
      }
    },
    [flush, refreshCheckpoints, repository]
  );

  useEffect(() => {
    if (!workspace?.activeRunId) return;
    void refreshCheckpoints(workspace.activeRunId);
  }, [refreshCheckpoints, workspace?.activeRunId]);

  useEffect(() => {
    const saveBeforeLeaving = () => {
      if (!workspaceRef.current) return;
      void flush();
    };
    const saveWhenHidden = () => {
      if (document.visibilityState === "hidden") saveBeforeLeaving();
    };

    window.addEventListener("pagehide", saveBeforeLeaving);
    document.addEventListener("visibilitychange", saveWhenHidden);
    return () => {
      window.removeEventListener("pagehide", saveBeforeLeaving);
      document.removeEventListener("visibilitychange", saveWhenHidden);
    };
  }, [flush]);

  if (loadingError) {
    return (
      <main className="boot-error">
        <h1>Creative Compass could not restore this workspace.</h1>
        <p>{loadingError.message}</p>
      </main>
    );
  }

  if (!workspace) {
    return (
      <main className="boot-loading" aria-live="polite">
        Loading Creative Compass...
      </main>
    );
  }

  return (
    <WorkspaceContext.Provider
      value={{
        workspace,
        dispatch,
        persistenceError,
        persistenceStatus,
        lastSavedAt,
        flush,
        checkpoints,
        checkpointError,
        checkpointBusy,
        createCheckpoint,
        refreshCheckpoints,
        restoreCheckpoint
      }}
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

export function useOptionalWorkspace(): WorkspaceContextValue | null {
  return useContext(WorkspaceContext);
}

function toError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(fallback);
}
