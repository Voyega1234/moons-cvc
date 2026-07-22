import type { WorkspaceState } from "../../features/workflow/model";
import type {
  WorkspaceCheckpoint,
  WorkspaceCheckpointReason,
  WorkspaceRepository
} from "../../ports/workspace-repository";
import {
  deserializeWorkspace,
  serializeWorkspace
} from "../../services/workspace/workspace-serializer";
import { createId } from "../../shared/utils/id";

export const DEFAULT_WORKSPACE_STORAGE_KEY = "moons.workspace";
const LOCAL_CHECKPOINT_LIMIT = 3;

interface LocalWorkspaceCheckpoint extends WorkspaceCheckpoint {
  snapshot: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class LocalWorkspaceRepository implements WorkspaceRepository {
  constructor(
    private readonly storage: StorageLike,
    private readonly storageKey = DEFAULT_WORKSPACE_STORAGE_KEY,
    private readonly getNow = () => new Date().toISOString()
  ) {}

  async load(): Promise<WorkspaceState | null> {
    const raw = this.storage.getItem(this.storageKey);
    if (!raw) return null;

    const workspace = deserializeWorkspace(raw);
    if (workspace) return workspace;

    this.storage.removeItem(this.storageKey);
    return null;
  }

  async save(workspace: WorkspaceState): Promise<void> {
    this.storage.setItem(
      this.storageKey,
      serializeWorkspace(workspace, this.getNow())
    );
  }

  async clear(): Promise<void> {
    this.storage.removeItem(this.storageKey);
    this.storage.removeItem(this.checkpointStorageKey());
  }

  async createCheckpoint(
    workspace: WorkspaceState,
    runId: string,
    reason: WorkspaceCheckpointReason
  ): Promise<WorkspaceCheckpoint> {
    const run = workspace.runsById[runId];
    if (!run) throw new Error("Project not found for recovery point.");
    const createdAt = this.getNow();
    const entry: LocalWorkspaceCheckpoint = {
      id: createId("checkpoint"),
      runId,
      reason,
      createdAt,
      createdBy: "This browser",
      sourceVersion: null,
      snapshot: serializeWorkspace(singleRunWorkspace(run), createdAt)
    };
    let matchingRunCount = 0;
    const retained = [entry, ...this.readCheckpoints()].filter((item) => {
      if (item.runId !== runId) return true;
      matchingRunCount += 1;
      return matchingRunCount <= LOCAL_CHECKPOINT_LIMIT;
    });
    this.storage.setItem(this.checkpointStorageKey(), JSON.stringify(retained));
    return checkpointMetadata(entry);
  }

  async listCheckpoints(
    runId: string
  ): Promise<readonly WorkspaceCheckpoint[]> {
    return this.readCheckpoints()
      .filter((item) => item.runId === runId)
      .slice(0, LOCAL_CHECKPOINT_LIMIT)
      .map(checkpointMetadata);
  }

  async restoreCheckpoint(
    workspace: WorkspaceState,
    runId: string,
    checkpointId: string
  ): Promise<WorkspaceState> {
    const entry = this.readCheckpoints().find(
      (item) => item.id === checkpointId && item.runId === runId
    );
    const restoredWorkspace = entry
      ? deserializeWorkspace(entry.snapshot)
      : null;
    const restoredRun = restoredWorkspace?.runsById[runId];
    if (!restoredRun) throw new Error("Recovery point is unavailable.");
    const nextWorkspace = {
      ...workspace,
      runsById: { ...workspace.runsById, [runId]: restoredRun },
      toast: null
    };
    await this.save(nextWorkspace);
    return nextWorkspace;
  }

  private checkpointStorageKey(): string {
    return `${this.storageKey}.checkpoints`;
  }

  private readCheckpoints(): readonly LocalWorkspaceCheckpoint[] {
    const raw = this.storage.getItem(this.checkpointStorageKey());
    if (!raw) return [];
    try {
      const value = JSON.parse(raw) as unknown;
      if (!Array.isArray(value)) return [];
      return value.filter(isLocalCheckpoint);
    } catch {
      return [];
    }
  }
}

function singleRunWorkspace(
  run: WorkspaceState["runsById"][string]
): WorkspaceState {
  return {
    view: "studio",
    activeRunId: run.id,
    runOrder: [run.id],
    runsById: { [run.id]: run },
    toast: null
  };
}

function checkpointMetadata(
  checkpoint: LocalWorkspaceCheckpoint
): WorkspaceCheckpoint {
  const { snapshot: _snapshot, ...metadata } = checkpoint;
  return metadata;
}

function isLocalCheckpoint(value: unknown): value is LocalWorkspaceCheckpoint {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<LocalWorkspaceCheckpoint>;
  return (
    typeof item.id === "string" &&
    typeof item.runId === "string" &&
    ["regenerate", "replace-image", "send-to-qc"].includes(
      item.reason ?? ""
    ) &&
    typeof item.createdAt === "string" &&
    typeof item.createdBy === "string" &&
    (typeof item.sourceVersion === "number" || item.sourceVersion === null) &&
    typeof item.snapshot === "string"
  );
}
