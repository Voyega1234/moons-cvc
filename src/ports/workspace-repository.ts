import type { WorkspaceState } from "../features/workflow/model";

export type WorkspaceCheckpointReason =
  | "regenerate"
  | "replace-image"
  | "send-to-qc";

export interface WorkspaceCheckpoint {
  id: string;
  runId: string;
  reason: WorkspaceCheckpointReason;
  createdAt: string;
  createdBy: string;
  sourceVersion: number | null;
}

export interface WorkspaceRepository {
  load(): Promise<WorkspaceState | null>;
  save(workspace: WorkspaceState): Promise<void>;
  clear(): Promise<void>;
  createCheckpoint?(
    workspace: WorkspaceState,
    runId: string,
    reason: WorkspaceCheckpointReason
  ): Promise<WorkspaceCheckpoint>;
  listCheckpoints?(runId: string): Promise<readonly WorkspaceCheckpoint[]>;
  restoreCheckpoint?(
    workspace: WorkspaceState,
    runId: string,
    checkpointId: string
  ): Promise<WorkspaceState>;
}
