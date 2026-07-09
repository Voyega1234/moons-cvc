import type { WorkspaceState } from "../features/workflow/model";

export interface WorkspaceRepository {
  load(): Promise<WorkspaceState | null>;
  save(workspace: WorkspaceState): Promise<void>;
  clear(): Promise<void>;
}
