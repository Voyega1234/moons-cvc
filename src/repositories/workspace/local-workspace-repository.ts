import type { WorkspaceState } from "../../features/workflow/model";
import type { WorkspaceRepository } from "../../ports/workspace-repository";
import {
  deserializeWorkspace,
  serializeWorkspace
} from "../../services/workspace/workspace-serializer";

export const DEFAULT_WORKSPACE_STORAGE_KEY = "moons.workspace";

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
  }
}
